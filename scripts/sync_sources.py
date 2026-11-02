import json
import re
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "sources.json"
OUTPUT = ROOT / "data" / "catalog.json"
REPORT = ROOT / "reports" / "sync-report.json"

USER_AGENT = "TV-BRASIL-ENGINE/1.0"


def fetch_playlist(url):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT}
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def parse_m3u(content, source_id):
    channels = []
    current = None

    for line in content.splitlines():
        line = line.strip()

        if line.startswith("#EXTINF:"):
            name = line.split(",")[-1].strip()

            tvg_id = re.search(r'tvg-id="([^"]*)"', line)
            logo = re.search(r'tvg-logo="([^"]*)"', line)
            group = re.search(r'group-title="([^"]*)"', line)

            current = {
                "id": tvg_id.group(1) if tvg_id else "",
                "name": name,
                "logo": logo.group(1) if logo else "",
                "category": group.group(1) if group else "Outros",
                "source": source_id
            }

        elif current and line.startswith("http"):
            parsed = urlparse(line)

            if parsed.scheme in ("http", "https") and parsed.netloc:
                channel = current.copy()
                channel["url"] = line
                channels.append(channel)

            current = None

    return channels


def main():
    if not CONFIG.exists():
        raise FileNotFoundError("config/sources.json não encontrado")

    config = json.loads(CONFIG.read_text(encoding="utf-8"))

    all_channels = []
    source_results = []

    for source in config.get("sources", []):
        if not source.get("enabled") or not source.get("playlist"):
            continue

        try:
            content = fetch_playlist(source["playlist"])
            channels = parse_m3u(content, source["id"])

            if not channels:
                raise ValueError("Playlist sem canais válidos")

            all_channels.extend(channels)

            source_results.append({
                "source": source["id"],
                "status": "success",
                "channels": len(channels)
            })

            print(f'{source["name"]}: {len(channels)} canais')

        except Exception as error:
            source_results.append({
                "source": source["id"],
                "status": "error",
                "error": str(error)
            })

            print(f'ERRO {source["id"]}: {error}')

    # Remove duplicatas por URL, preservando a primeira ocorrência.
    unique = {}
    for channel in all_channels:
        unique.setdefault(channel["url"], channel)

    catalog = list(unique.values())

    # Não substitui o catálogo anterior se todas as fontes falharem.
    if not catalog:
        raise RuntimeError(
            "Nenhum canal coletado. Catálogo anterior preservado."
        )

    catalog.sort(key=lambda item: item["name"].lower())

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)

    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_channels": len(catalog),
        "channels": catalog
    }

    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    temporary.replace(OUTPUT)

    report = {
        "updated_at": result["updated_at"],
        "total_collected": len(all_channels),
        "total_unique": len(catalog),
        "sources": source_results
    }

    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"TOTAL: {len(catalog)} canais únicos")
    print("Catálogo atualizado com sucesso!")


if __name__ == "__main__":
    main()
  
