import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
STREAM_REPORT = ROOT / "reports" / "validation-report.json"
HLS_REPORT = ROOT / "reports" / "hls-validation-report.json"
OUTPUT = ROOT / "data" / "catalog-final.json"
RETRY_OUTPUT = ROOT / "reports" / "retry-queue.json"

# Formats detected by validate_streams.py and safe to expose as direct media
# streams without requiring the HLS playlist/segment check.
DIRECT_MEDIA_FORMATS = {"mpegts", "mp4", "video", "audio"}


def read_json(path):
    if not path.exists():
        raise FileNotFoundError(f"Arquivo obrigatório não encontrado: {path.relative_to(ROOT)}")
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_url(url):
    if not url:
        return ""
    parts = urlsplit(url.strip())
    return urlunsplit((
        parts.scheme.lower(),
        parts.netloc.lower(),
        parts.path,
        parts.query,
        ""  # fragments do not identify a different media stream
    ))


def categories_for(channel):
    raw = channel.get("category") or "Outros"
    if isinstance(raw, list):
        values = raw
    else:
        values = str(raw).replace(",", ";").split(";")
    cleaned = sorted({str(value).strip() for value in values if str(value).strip()})
    return cleaned or ["Outros"]


def compact_channel(channel, playback_check):
    categories = categories_for(channel)
    return {
        "id": channel.get("id") or "",
        "name": channel.get("name") or channel.get("id") or "Canal sem nome",
        "logo": channel.get("logo") or "",
        "category": categories[0],
        "categories": categories,
        "source": channel.get("source") or "",
        "url": channel.get("url") or "",
        "format": (channel.get("format") or "unknown").lower(),
        "playback_check": playback_check
    }


def add_retry(retries, seen, channel, reason, stage):
    key = canonical_url(channel.get("url")) or channel.get("id") or channel.get("name")
    if not key or key in seen:
        return
    seen.add(key)
    retries.append({
        "id": channel.get("id") or "",
        "name": channel.get("name") or channel.get("id") or "Canal sem nome",
        "url": channel.get("url") or "",
        "source": channel.get("source") or "",
        "format": channel.get("format") or "",
        "category": channel.get("category") or "Outros",
        "retry_stage": stage,
        "retry_reason": reason
    })


def main():
    stream_report = read_json(STREAM_REPORT)
    hls_report = read_json(HLS_REPORT)

    # Only HLS entries that passed both playlist and first-segment checks
    # enter the HLS portion of the final catalog.
    hls_results = hls_report.get("channels", [])
    hls_passed = [
        item for item in hls_results
        if item.get("hls_validation") == "playlist_and_segment_ok"
    ]

    # Keep positively detected non-HLS media (currently MPEG-TS) instead of
    # dropping them merely because the HLS validator does not inspect them.
    stream_results = stream_report.get("channels", [])
    direct_media = [
        item for item in stream_results
        if item.get("validation") == "media_detected"
        and (item.get("format") or "").lower() in DIRECT_MEDIA_FORMATS
    ]

    selected = []
    selected_keys = set()
    duplicate_count = 0

    for item in hls_passed:
        candidate = compact_channel(item, "hls_playlist_and_first_segment_ok")
        key = canonical_url(candidate["url"]) or candidate["id"] or candidate["name"]
        if key in selected_keys:
            duplicate_count += 1
            continue
        selected_keys.add(key)
        selected.append(candidate)

    for item in direct_media:
        candidate = compact_channel(item, "media_detected_probe_only")
        key = canonical_url(candidate["url"]) or candidate["id"] or candidate["name"]
        if key in selected_keys:
            duplicate_count += 1
            continue
        selected_keys.add(key)
        selected.append(candidate)

    if not selected:
        raise RuntimeError("Nenhum canal aprovado. Catálogo final anterior preservado.")

    selected.sort(key=lambda item: (item["name"].casefold(), item["url"]))

    # Category index points to positions in the compact channels array.
    category_indexes = defaultdict(list)
    format_counts = Counter()
    for index, channel in enumerate(selected):
        format_counts[channel["format"]] += 1
        for category in channel["categories"]:
            category_indexes[category].append(index)

    categories = [
        {"name": name, "channel_indexes": indexes, "total": len(indexes)}
        for name, indexes in sorted(category_indexes.items(), key=lambda pair: pair[0].casefold())
    ]

    updated_at = datetime.now(timezone.utc).isoformat()
    final_catalog = {
        "schema_version": 1,
        "updated_at": updated_at,
        "total_channels": len(selected),
        "total_categories": len(categories),
        "deduplicated": duplicate_count,
        "counts_by_format": dict(sorted(format_counts.items())),
        "categories": categories,
        "channels": selected
    }

    # Keep every non-approved result available for a later retry. This is
    # separate from the original detailed validation reports, which are kept.
    retries = []
    retry_keys = set()

    for item in hls_results:
        status = item.get("hls_validation", "unknown")
        if status != "playlist_and_segment_ok":
            add_retry(retries, retry_keys, item, status, "hls")

    for item in stream_results:
        status = item.get("validation", "unknown")
        media_format = (item.get("format") or "").lower()
        if status != "media_detected":
            add_retry(retries, retry_keys, item, status, "stream_probe")
        elif media_format == "hls":
            # HLS failures are already recorded with the more specific reason above.
            continue
        elif media_format not in DIRECT_MEDIA_FORMATS:
            add_retry(retries, retry_keys, item, f"unsupported_format:{media_format or 'unknown'}", "format_review")

    retry_report = {
        "updated_at": updated_at,
        "total_retry_candidates": len(retries),
        "items": retries
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    RETRY_OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    # Compact JSON (no indentation) reduces transfer size for the PWA.
    temp_output = OUTPUT.with_suffix(".tmp")
    temp_output.write_text(
        json.dumps(final_catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8"
    )
    temp_output.replace(OUTPUT)

    temp_retry = RETRY_OUTPUT.with_suffix(".tmp")
    temp_retry.write_text(
        json.dumps(retry_report, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    temp_retry.replace(RETRY_OUTPUT)

    print("CATÁLOGO FINAL")
    print(f"Canais únicos publicados: {len(selected)}")
    print(f"  HLS aprovado: {len(hls_passed)}")
    print(f"  Outros formatos compatíveis: {len(direct_media)}")
    print(f"Duplicatas removidas: {duplicate_count}")
    print(f"Categorias: {len(categories)}")
    print(f"Formatos: {dict(sorted(format_counts.items()))}")
    print(f"Fila de novas tentativas: {len(retries)}")
    print(f"Catálogo PWA: {OUTPUT.relative_to(ROOT)}")
    print(f"Relatório de novas tentativas: {RETRY_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
