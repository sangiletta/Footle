"""
Escudoteca PNG Downloader (full site)
-------------------------------------
- Crawls https://paladarnegro.net/escudoteca/ starting from index.html
- Collects every .png link under /escudoteca/ (country/league/png/*.png)
- Downloads preserving the original folder structure:
  ./escudoteca/argentina/primeradivision/png/club.png

Usage (Windows PowerShell / macOS / Linux):
  pip install requests beautifulsoup4 tqdm
  python descargar_escudoteca.py

Options you might tweak below:
  OUTDIR, MAX_WORKERS, SLEEP_BETWEEN, INCLUDE_ZIP (False by default)
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

BASE = "https://paladarnegro.net/escudoteca/"
START = urljoin(BASE, "index.html")
OUTDIR = "escudoteca"          # root output folder
MAX_WORKERS = 6                # parallel downloads for files
TIMEOUT = 25
RETRY = 3
SLEEP_BETWEEN = (0.20, 0.80)   # polite random sleep (seconds) between requests
INCLUDE_ZIP = False            # set True if you also want league ZIP packs

session = requests.Session()
session.headers.update({
    "User-Agent": "escudoteca-downloader/1.0 (+personal use)"
})

lock = threading.Lock()
page_frontier = []
visited_pages = set()
png_urls = set()
zip_urls = set()

BIN_EXT = re.compile(r"\.(png|zip|svg|pdf|jpg|jpeg|gif|webp|ico)$", re.I)
HTML_CTYPES = ("text/html", "text/plain", "application/xhtml+xml")

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
    # simple retry loop
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
    # join and clean fragments
    u = urljoin(base, href)
    # strip anchors/query for our purpose
    parts = urlparse(u)
    return parts._replace(fragment="", query="").geturl()

def scrape_page(url: str):
    # Skip if already done
    with lock:
        if url in visited_pages:
            return
        visited_pages.add(url)

    r = get(url)
    if not r:
        return

    ctype = r.headers.get("Content-Type", "")
    if not any(ctype.startswith(x) for x in HTML_CTYPES):
        return

    soup = BeautifulSoup(r.text, "html.parser")

    # collect PNG links
    for a in soup.find_all("a", href=True):
        href = norm_join(url, a["href"])
        if href.lower().endswith(".png") and is_internal(href):
            with lock:
                png_urls.add(href)

    # optionally collect ZIP packs (league packs)
    if INCLUDE_ZIP:
        for a in soup.find_all("a", href=True):
            href = norm_join(url, a["href"])
            if href.lower().endswith(".zip") and is_internal(href):
                with lock:
                    zip_urls.add(href)

    # enqueue more pages to crawl (only internal under /escudoteca/)
    for a in soup.find_all("a", href=True):
        href = norm_join(url, a["href"])
        if not is_internal(href):
            continue
        # don't enqueue binary files; we only crawl HTML pages
        if BIN_EXT.search(href):
            continue
        with lock:
            if href not in visited_pages:
                page_frontier.append(href)

def local_path_from_url(file_url: str) -> str:
    """
    Map https://paladarnegro.net/escudoteca/argentina/primeradivision/png/xxx.png
    to ./escudoteca/argentina/primeradivision/png/xxx.png
    """
    path = urlparse(file_url).path
    # ensure it always starts with /escudoteca/
    if "/escudoteca/" not in path:
        raise ValueError(f"Unexpected path outside escudoteca: {path}")
    rel = path.split("/escudoteca/", 1)[1]  # e.g. "argentina/primeradivision/png/xxx.png"
    return os.path.join(OUTDIR, "escudoteca", rel)

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

    # Crawl (single-threaded traversal of HTML to avoid hammering)
    with tqdm(total=0, desc="Discovering pages", unit="page") as pbar:
        page_frontier.append(START)
        while page_frontier:
            url = page_frontier.pop(0)
            scrape_page(url)
            pbar.total = len(visited_pages)
            pbar.update(0)  # refresh display

    png_list = sorted(png_urls)
    print(f"\nDiscovered PNG files: {len(png_list)}")

    # Download PNGs
    ok = 0
    if png_list:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex, \
             tqdm(total=len(png_list), desc="Downloading PNG", unit="file") as bar:
            futures = [ex.submit(save_file, u) for u in png_list]
            for fut in as_completed(futures):
                _, success = fut.result()
                ok += int(success)
                bar.update(1)

    print(f"PNG done: {ok}/{len(png_list)} saved under ./{OUTDIR}")

    if INCLUDE_ZIP and zip_urls:
        zips = sorted(zip_urls)
        print(f"Discovered ZIP packs: {len(zips)}")
        okz = 0
        with ThreadPoolExecutor(max_workers=2) as ex, \
             tqdm(total=len(zips), desc="Downloading ZIP", unit="zip") as bar:
            futures = [ex.submit(save_file, u) for u in zips]
            for fut in as_completed(futures):
                _, success = fut.result()
                okz += int(success)
                bar.update(1)
        print(f"ZIP done: {okz}/{len(zips)}")

    print("All done.")

if __name__ == "__main__":
    main()
