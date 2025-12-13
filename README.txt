Buctril Super – Activations Dashboard (v2)

What you get
- CSV KPIs + charts + session table + map from sum_sheet.csv
- Backchecker insights from Buctril_Super_Activations.xlsx (all D* sheets)
- Responsive layout for mobile/tablet
- Lazy-loaded Media Gallery + accessible Lightbox modal
- Infinite loop “highlights” carousel

Repo structure (recommended)
/
  index.html
  data_processor.js
  sum_sheet.csv
  Buctril_Super_Activations.xlsx
  /assets
    bg.mp4                       (optional background video)
    /gallery
      media.json                 (captions/transcripts)
      sample1.jpg, sample2.jpg   (replace with your real files)
      sample1.mp4                (replace with your real files)
      captions.vtt               (optional captions for videos)

media.json format (array)
[
  {
    "type": "image",
    "src": "assets/gallery/IMG_001.jpg",
    "alt": "Farmers gathered at village session",
    "caption": "D3S2 – Q&A segment",
    "transcript": ""
  },
  {
    "type": "video",
    "src": "assets/gallery/VID_001.mp4",
    "alt": "Anchor explaining Golden Period",
    "caption": "Golden Period message",
    "vtt": "assets/gallery/VID_001.vtt",
    "transcript": "Short transcript text for accessibility."
  }
]

Notes
- Map supports DMS coordinates like: 30°11'52"N, 71°28'11"E
- Message clarity:
  - If Average Understanding Score is 1–3, dashboard converts to percent: score/3*100
- Backchecker extraction:
  - The JS uses keyword matching on D* sheets to locate:
    - demo plot desire %
    - activations happen often %
    - benefited during engagement breakdown (Q&A / Discussion / Anchor opening / Gifts, etc.)
    - post-event definite / awareness / clarity
    - expected sales increase
  - If any sheet layout differs, it will appear in Diagnostics.

GitHub Pages
- Commit all files to your repo main branch.
- Settings → Pages → Deploy from branch → main / root
