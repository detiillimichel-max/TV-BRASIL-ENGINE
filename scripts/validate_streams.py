import json
import urllib.request
import urllib.error
import concurrent.futures
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]

INPUT = ROOT / "data" / "catalog.json"
VALIDATED = ROOT / "data" / "catalog-validated.json"
REPORT = ROOT / "reports" / "validation-report.json"

TIMEOUT = 12
MAX_WORKERS = 8
READ_SIZE = 4096

USER_AGENT = "TV-BRASIL-ENGINE/1.0"


def detect_media(data, content_type):
    content_type = content_type.lower()

    # HLS playlist
    if b"#EXTM3U" in data[:READ_SIZE]:
        return "hls"

    if "mpegurl" in content_type:
        return "hls"

    # MPEG-TS
    if "mp2t" in content_type:
        return "mpegts"

    for offset in range(min(188, len(data))):
        if (
            data[offset:offset + 1] == b"\x47"
            and data[offset + 188:offset + 189] == b"\x47"
            and data[offset + 376:offset + 377] == b"\x47"
        ):
            return "mpegts"

    # MP4
    if len(data) >= 8 and data[4:8] == b"ftyp":
        return "mp4"

    if "video/" in content_type:
        return "video"

    if "audio/" in content_type:
        return "audio"

    return None


def validate_channel(channel):
    url = channel.get("url", "")

    if not url.startswith(("http://", "https://")):
        return {
            **channel,
            "validation": "invalid_url",
            "http_status": None,
            "format": None
        }

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Range": "bytes=0-4095"
        }
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=TIMEOUT
        ) as response:

            status = response.status
            content_type = response.headers.get(
                "Content-Type", ""
            )

            data = response.read(READ_SIZE)

            media_format = detect_media(
                data,
                content_type
            )

            result = "media_detected" if media_format else "unknown"

            return {
                **channel,
                "validation": result,
                "http_status": status,
                "format": media_format
            }

    except urllib.error.HTTPError as error:
        status = error.code

        result = (
            "blocked"
            if status in (401, 403, 429)
            else "unavailable"
        )

        return {
            **channel,
            "validation": result,
            "http_status": status,
            "format": None
        }

    except Exception:
        return {
            **channel,
            "validation": "unavailable",
            "http_status": None,
            "format": None
        }


def main():
    if not INPUT.exists():
        raise FileNotFoundError(
            "data/catalog.json não encontrado"
        )

    catalog = json.loads(
        INPUT.read_text(encoding="utf-8")
    )

    channels = catalog.get("channels", [])

    print(f"Validando {len(channels)} canais...")

    results = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as executor:

        results = list(
            executor.map(validate_channel, channels)
        )

    approved = [
        item for item in results
        if item["validation"] == "media_detected"
    ]

    summary = {}

    for item in results:
        status = item["validation"]
        summary[status] = summary.get(status, 0) + 1

    updated_at = datetime.now(timezone.utc).isoformat()

    report = {
        "updated_at": updated_at,
        "total_tested": len(results),
        "total_media_detected": len(approved),
        "results": summary,
        "channels": results
    }

    REPORT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # Preserva o último catálogo aprovado
    # caso nenhuma transmissão seja detectada.
    if approved:
        validated_catalog = {
            "updated_at": updated_at,
            "total_channels": len(approved),
            "channels": approved
        }

        temporary = VALIDATED.with_suffix(".tmp")

        temporary.write_text(
            json.dumps(
                validated_catalog,
                ensure_ascii=False,
                indent=2
            ),
            encoding="utf-8"
        )

        temporary.replace(VALIDATED)

    print("\nRESULTADO DA VALIDAÇÃO")

    for status, total in sorted(summary.items()):
        print(f"{status}: {total}")

    print(f"\nMídia detectada: {len(approved)}")
    print("Relatório gerado com sucesso!")


if __name__ == "__main__":
    main()
  
