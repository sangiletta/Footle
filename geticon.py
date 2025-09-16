"""
Escudoteca PNG Downloader (full site, per country/division)
----------------------------------------------------------
- Descubre TODOS los países y TODAS sus divisiones (primer nivel bajo el país).
- Para cada división recorre solo sus páginas y descarga todos los .png (y opcional .zip).
- Conserva la estructura de carpetas: ./escudoteca/<pais>/<division>/.../*.png

Uso (Windows PowerShell / macOS / Linux):
  pip install requests beautifulsoup4 tqdm
  python descargar_escudoteca.py

Ajustes rápidos:
  OUTDIR, MAX_WORKERS, SLEEP_BETWEEN, INCLUDE_ZIP
"""

import os
import re
import time
import threading
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

BASE   = "https://paladarnegro.net/escudoteca/"
START  = urljoin(BASE, "index.html")
OUTDIR = "escudoteca"         # carpeta raíz local
MAX_WORKERS = 3               # paralelismo al descargar archivos
TIMEOUT = 25
RETRY   = 3
SLEEP_BETWEEN = (0.80, 1.20)  # pausa aleatoria educada entre requests
INCLUDE_ZIP   = False         # True si también querés packs .zip

session = requests.Session()
session.headers.update({"User-Agent": "escudoteca-downloader/1.1 (+personal use)"})

lock = threading.Lock()

HTML_CTYPES = ("text/html", "text/plain", "application/xhtml+xml")
BIN_EXT = re.compile(r"\.(png|zip|svg|pdf|jpg|jpeg|gif|webp|ico)$", re.I)

def polite_sleep():
    import random
    time.sleep(random.uniform(*SLEEP_BETWEEN))

def is_internal(url: str) -> bool:
    try:
        u = urlparse(url)
        b = urlparse(BASE)
        return (u.netloc == b.netloc) and ("/escudoteca/" in u.path)
    except Exception:
        return False

def get(url: str):
    for _ in range(RETRY):
        try:
            r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
            if r.status_code == 200:
                return r
        except requests.RequestException:
            pass
        polite_sleep()
    return None

def norm_join(base: str, href: str) -> str:
    u = urljoin(base, href)
    parts = urlparse(u)
    return parts._replace(fragment="", query="").geturl()

def path_after_root(url_or_path: str) -> str:
    """Devuelve lo que viene después de /escudoteca/ en la URL o path."""
    path = urlparse(url_or_path).path if "://" in url_or_path else url_or_path
    if "/escudoteca/" not in path:
        return ""
    return path.split("/escudoteca/", 1)[1].lstrip("/")

def first_segments_after_root(url: str, n=2):
    """Devuelve los primeros n segmentos después de /escudoteca/."""
    rest = path_after_root(url)
    parts = [p for p in rest.split("/") if p]
    return parts[:n]

def is_dir_link(href: str) -> bool:
    """Aproximación: enlaces que parecen carpeta (terminan en / o no tienen extensión)."""
    p = urlparse(href).path
    return p.endswith("/") or ('.' not in os.path.basename(p))

def discover_country_urls():
    """Descubre todos los países (primer segmento bajo /escudoteca/)."""
    r = get(START)
    if not r:
        return set()
    soup = BeautifulSoup(r.text, "html.parser")
    countries = set()
    for a in soup.find_all("a", href=True):
        href = norm_join(START, a["href"])
        if not is_internal(href):
            continue
        segs = first_segments_after_root(href, n=1)
        if len(segs) == 1:
            country = segs[0]
            # armamos URL de país con trailing slash
            countries.add(urljoin(BASE, f"{country}/"))
    return countries

def discover_divisions_for_country(country_url: str):
    """
    Descubre TODAS las divisiones de un país:
    - Busca links internos bajo /escudoteca/<pais>/ y toma el primer nivel tras el país.
    """
    r = get(country_url)
    if not r:
        return set()
    soup = BeautifulSoup(r.text, "html.parser")
    divisions = set()
    for a in soup.find_all("a", href=True):
        href = norm_join(country_url, a["href"])
        if not is_internal(href):
            continue
        segs = first_segments_after_root(href, n=2)
        if len(segs) >= 2:
            country, division = segs[0], segs[1]
            # URL normalizada de la división
            divisions.add(urljoin(BASE, f"{country}/{division}/"))
    return divisions

def crawl_division_for_files(division_url: str):
    """
    Recorre SOLO páginas bajo la ruta de la división y junta todos los .png (y opcional .zip).
    """
    png_urls = set()
    zip_urls = set()
    visited = set()
    frontier = [division_url]

    div_prefix = urlparse(division_url).path.rstrip("/") + "/"

    while frontier:
        url = frontier.pop(0)
        if url in visited:
            continue
        visited.add(url)

        r = get(url)
        if not r:
            continue
        ctype = r.headers.get("Content-Type", "")
        if not any(ctype.startswith(x) for x in HTML_CTYPES):
            continue

        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = norm_join(url, a["href"])
            if not is_internal(href):
                continue
            path = urlparse(href).path
            # limitarse a la misma división
            if not path.startswith(div_prefix):
                continue

            low = href.lower()
            if low.endswith(".png"):
                png_urls.add(href)
                continue
            if INCLUDE_ZIP and low.endswith(".zip"):
                zip_urls.add(href)
                continue

            # si parece carpeta o html: seguir recorriendo
            if not BIN_EXT.search(href):
                if href not in visited:
                    frontier.append(href)

    return png_urls, zip_urls

def local_path_from_url(file_url: str) -> str:
    """
    https://paladarnegro.net/escudoteca/argentina/primeradivision/png/xxx.png
    -> ./escudoteca/argentina/primeradivision/png/xxx.png
    """
    rel = path_after_root(file_url)  # e.g. argentina/primeradivision/png/xxx.png
    return os.path.join(OUTDIR, rel)

def save_file(file_url: str):
    r = get(file_url)
    if not r:
        return file_url, False
    out_path = local_path_from_url(file_url)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(r.content)
    polite_sleep()
    return file_url, True

def main():
    os.makedirs(OUTDIR, exist_ok=True)

    # 1) países
    countries = sorted(discover_country_urls())
    if not countries:
        print("No se pudieron descubrir países desde el índice.")
        return
    print(f"Países detectados: {len(countries)}")

    # 2) divisiones por país
    country_to_divs = {}
    total_divs = 0
    for cu in tqdm(countries, desc="Descubriendo divisiones", unit="pais"):
        divs = sorted(discover_divisions_for_country(cu))
        country_to_divs[cu] = divs
        total_divs += len(divs)

    print(f"Divisiones detectadas: {total_divs}")

    # 3) recorrer cada división y juntar archivos
    all_pngs = set()
    all_zips = set()

    for cu, divs in country_to_divs.items():
        country_name = first_segments_after_root(cu, n=1)[0]
        for du in tqdm(divs, desc=f"{country_name}: divisiones", unit="div"):
            pngs, zips = crawl_division_for_files(du)
            all_pngs.update(pngs)
            all_zips.update(zips)

    print(f"\nPNG descubiertos: {len(all_pngs)}")
    if INCLUDE_ZIP:
        print(f"ZIP descubiertos: {len(all_zips)}")

    # 4) descargar
    ok = 0
    if all_pngs:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex, \
             tqdm(total=len(all_pngs), desc="Descargando PNG", unit="file") as bar:
            futures = [ex.submit(save_file, u) for u in sorted(all_pngs)]
            for fut in as_completed(futures):
                _, success = fut.result()
                ok += int(success)
                bar.update(1)
    print(f"PNG OK: {ok}/{len(all_pngs)} guardados en ./{OUTDIR}")

    if INCLUDE_ZIP and all_zips:
        okz = 0
        with ThreadPoolExecutor(max_workers=2) as ex, \
             tqdm(total=len(all_zips), desc="Descargando ZIP", unit="zip") as bar:
            futures = [ex.submit(save_file, u) for u in sorted(all_zips)]
            for fut in as_completed(futures):
                _, success = fut.result()
                okz += int(success)
                bar.update(1)
        print(f"ZIP OK: {okz}/{len(all_zips)}")

    print("Hecho.")

if __name__ == "__main__":
    main()
