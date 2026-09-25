# Rój

Przeglądarkowa gra na telefon i laptop: prowadzisz rój świetlików z dna nocnego lasu aż do księżyca. Ciemny świat, jedynym światłem jest rój.

- **Sterowanie:** przeciągaj palcem (albo trzymaj mysz) — rój leci za ruchem. Dwa stuknięcia / dwuklik / spacja — Rozbłysk.
- **Projekt gry:** [docs/PLAN.md](docs/PLAN.md)

```bash
npm install
npm run dev      # serwer deweloperski
npm run build    # statyczne pliki w dist/
```

Każdy push na `main` buduje grę i publikuje ją na GitHub Pages (`.github/workflows/pages.yml`). W ustawieniach repozytorium: Settings → Pages → Source: **GitHub Actions**.
