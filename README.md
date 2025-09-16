# Flagle de Fútbol (build limpio de fades)

Este build vuelve a lo básico para las animaciones: **dos capas superpuestas**

- **canvas** (debajo): muestra el *guess/objetivo revelado*.
- **overlay** (arriba): muestra el **clubSelected** del turno.

Las animaciones son **solo** transiciones de **opacidad** (sin keyframes/clases).

## Estructura
```
index.html
styles.css
app.js
build_catalog.py
escudoteca/      # tu mirror de PNGs (pais/liga/png/*.png)
```

## Correr
```bash
python build_catalog.py
python -m http.server 5173
# abrir http://localhost:5173
```

## Ajustar velocidad de fades
En `app.js`:
```js
const FADE_MS = {
  selectedIn: 180,  // fade-in de clubSelected (overlay)
  cross: 320        // overlay OUT y canvas IN simultáneos
};
```

## Nota sobre tamaños
- El canvas usa `width:100%; height:auto;` para que **no crezca** más que el contenedor.
- La overlay cubre exactamente el canvas con `position:absolute; inset:0; z-index:2`.
