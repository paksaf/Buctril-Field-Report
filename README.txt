AgriVista (fixed package)

Required files in the same folder:
- index.html
- data_processor.js
- media.json
- Buctril_Super_Activations.xlsx
- assets/ (optional: bg.mp4 and your gallery images/videos)

Important:
1) Do NOT open with file:// — use a local server or GitHub Pages.
2) If Buctril_Super_Activations.xlsx is stored via Git LFS, GitHub Pages will usually serve a *pointer* file.
   In that case, commit the real XLSX (or export to CSV/JSON) so fetch() can download it.

Quick local server:
- Python:  python3 -m http.server 8000
Then open: http://localhost:8000/
