import concurrent.futures
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

INPUT = ROOT / "data" / "catalog-validated.json"
OUTPUT = ROOT / "data" / "catalog-hls-validated.json"
REPORT = ROOT / "reports" / "hls-validation-report.json"

TIMEOUT = 15
MAX_WORKERS = 6
MAX_PLAYLIST_BYTES = 1_000_000
SEGMENT_RANGE = "bytes=0-2047"
USER_AGENT = "TV-BRASIL-ENGINE/1.0"


class HLSCheckError(Exception):
    def __init__(self, status, http_status=None):
        super().__init__(status)
        self.status = status
        self.http_status = http_status


def fetch(url, limit, range_header=None):
    parsed = urllib.parse.urlparse(url)

    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HLSCheckError("invalid_url")

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*"
    }

    if range_header:
        headers["Range"] = range_header

    request = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            data = response.read(limit)

            if status not in (200, 206):
                raise HLSCheckError("http_error", status)

            return data, response.geturl(), status, content_type

    except urllib.error.HTTPError as error:
        if error.code in (401, 403, 429):
            raise HLSCheckError("blocked", error.code)
        if error.code == 404 or error.code == 410:
            raise HLSCheckError("not_found", error.code)
        raise HLSCheckError("http_error", error.code)

    except urllib.error.URLError as error:
        reason = getattr(error, "reason", None)
        if isinstance(reason, TimeoutError):
            raise HLSCheckError("timeout")
        raise HLSCheckError("connection_error")

    except TimeoutError:
        raise HLSCheckError("timeout")


def parse_playlist(data, final_url):
    text = data.decode("utf-8-sig", errors="replace")
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    if not lines or lines[0] != "#EXTM3U":
        raise HLSCheckError("invalid_playlist")

    # Master playlist: select the first declared variant.
    for index, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF:"):
            for candidate in lines[index + 1:]:
                if not candidate.startswith("#"):
                    return "master", urllib.parse.urljoin(final_url, candidate)

    # Media playlist: locate the first media segment.
    for line in lines:
        if line.startswith("#"):
            continue
        if line.startswith(("http://", "https://")) or not line.startswith("data:"):
            return "media", urllib.parse.urljoin(final_url, line)

    raise HLSCheckError("playlist_without_segments")


def check_channel(channel):
    original_url = channel.get("url", "")

    try:
        playlist_data, final_url, playlist_status, content_type = fetch(
            original_url,
            MAX_PLAYLIST_BYTES
        )

        if (
            b"#EXTM3U" not in playlist_data[:4096]
            and "mpegurl" not in content_type.lower()
        ):
            raise HLSCheckError("not_hls", playlist_status)

        playlist_type, media_url = parse_playlist(
            playlist_data,
            final_url
        )

        segment_data, segment_final_url, segment_status, segment_type = fetch(
            media_url,
            2048,
            SEGMENT_RANGE
        )

        if not segment_data:
            raise HLSCheckError("empty_segment", segment_status)

        # A successful HTTP response with bytes is a positive segment check,
        # not a guarantee that every player/device can decode the stream.
        result = {
            **channel,
            "hls_validation": "playlist_and_segment_ok",
            "hls_playlist_type": playlist_type,
            "hls_http_status": playlist_status,
            "segment_http_status": segment_status,
            "segment_bytes_received": len(segment_data),
            "hls_checked_at": datetime.now(timezone.utc).isoformat()
        }
        return result

    except HLSCheckError as error:
        return {
            **channel,
            "hls_validation": error.status,
            "hls_http_status": error.http_status,
            "hls_checked_at": datetime.now(timezone.utc).isoformat()
        }

    except Exception:
        return {
            **channel,
            "hls_validation": "unexpected_error",
            "hls_http_status": None,
            "hls_checked_at": datetime.now(timezone.utc).isoformat()
        }


def main():
    if not INPUT.exists():
        raise FileNotFoundError(
            "data/catalog-validated.json não encontrado. "
            "Execute primeiro scripts/validate_streams.py."
        )

    catalog = json.loads(INPUT.read_text(encoding="utf-8"))
    channels = catalog.get("channels", [])

    hls_channels = [
        channel for channel in channels
        if str(channel.get("format", "")).lower() == "hls"
    ]

    skipped = len(channels) - len(hls_channels)
    print(f"Catálogo recebido: {len(channels)} canais")
    print(f"Playlists HLS para testar: {len(hls_channels)}")
    print(f"Outros formatos ignorados: {skipped}")

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as executor:
        results = list(executor.map(check_channel, hls_channels))

    summary = {}
    for item in results:
        status = item["hls_validation"]
        summary[status] = summary.get(status, 0) + 1

    passed = [
        item for item in results
        if item["hls_validation"] == "playlist_and_segment_ok"
    ]

    updated_at = datetime.now(timezone.utc).isoformat()

    report = {
        "updated_at": updated_at,
        "total_input_channels": len(channels),
        "total_hls_tested": len(hls_channels),
        "total_other_formats_skipped": skipped,
        "total_playlist_and_segment_ok": len(passed),
        "results": summary,
        "channels": results
    }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # Preserve the previous output if this run finds no passing HLS streams.
    if passed:
        validated = {
            "updated_at": updated_at,
            "total_channels": len(passed),
            "validation_level": "hls_playlist_and_first_segment",
            "channels": passed
        }

        temporary = OUTPUT.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(validated, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        temporary.replace(OUTPUT)

    print("\nRESULTADO HLS")
    for status, total in sorted(summary.items()):
        print(f"{status}: {total}")

    print(f"Playlists e primeiro segmento acessíveis: {len(passed)}")
    print(f"Relatório: {REPORT.relative_to(ROOT)}")
    if passed:
        print(f"Catálogo HLS: {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
