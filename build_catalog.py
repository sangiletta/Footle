import os, json

ROOT = "escudoteca"   # carpeta local donde están los PNG (pais/liga/png/*.png)
OUT  = "catalog.json"

def is_png_dir(dirpath):
  return os.path.basename(dirpath).lower() == "png"

def pretty_name(filename):
  name, _ = os.path.splitext(os.path.basename(filename))
  return name.replace("_"," ").replace("-"," ").title()

def rel_server_path(p):
  p = p.replace("\\", "/")
  if not p.startswith("./") and not p.startswith("/"):
    p = "./" + p
  return p

items = []
for dirpath, _, files in os.walk(ROOT):
  if not is_png_dir(dirpath):
    continue
  parts = dirpath.replace("\\","/").split("/")
  try:
    idx_png = len(parts) - 1
    league = parts[idx_png - 1].lower() if idx_png - 1 >= 0 else ""
    country = parts[idx_png - 2].lower() if idx_png - 2 >= 0 else ""
  except Exception:
    continue
  if not country or not league:
    continue
  for f in files:
    if f.lower().endswith(".png"):
      full = os.path.join(dirpath, f)
      items.append({
        "country": country,
        "league": league,
        "name": pretty_name(f),
        "crest": rel_server_path(full)
      })

data = {"items": items}
with open(OUT, "w", encoding="utf-8") as fp:
  json.dump(data, fp, ensure_ascii=False, indent=2)

print(f"Wrote {OUT} with {len(items)} items.")
