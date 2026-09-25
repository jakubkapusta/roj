# Rój — projekt gry

Przeglądarkowa gra na telefon (pion, jeden kciuk) i laptop. Prowadzisz rój świetlików z dna nocnego lasu aż na niebo. Jedna wyprawa ≈ jeden dojazd (~15 min).

## Ustalenia

| Temat | Decyzja |
| --- | --- |
| Styl | **Światło w mroku** — ciemny świat 2D w warstwach paralaksy; jedynym światłem jest rój. Rzuca cienie, promienie w mgle, oświetla krawędzie sylwetek. Mniej świetlików = ciemniej. |
| Kamera | Rój prowadzi, kamera jedzie za nim. Od dołu goni **Cień** — nie da się stać w miejscu w nieskończoność. |
| Orientacja | Pionowa. Na laptopie ta sama kolumna gry na środku, po bokach ciemny las. |
| Porażka | Jedna **druga szansa** na wyprawę: odrodzenie przy ostatnim zapalonym lampionie z małym rojem. Potem koniec. |

## Sterowanie

- **Palec:** przeciąganie przesuwa cel roju względnie (kciuk może być gdziekolwiek, nie zasłania roju). Rój leci z bezwładnością; szybki ruch rozciąga go w warkocz, bezruch zbija w kulę.
- **Mysz:** przytrzymany przycisk — rój leci do kursora.
- **Puszczenie:** rój się rozluźnia, unosi w miejscu, świeci szerzej.
- **Podwójne stuknięcie / dwuklik / spacja:** Rozbłysk.

## Zasoby

- **Świetliki** — start 200, limit 800. Życie + zasięg światła + mnożnik punktów.
- **Blask** — 0–100, start 60, +1,5/s, +40 za lampion. Rozbłysk kosztuje 35.

## Synchronizacja (umiejętność)

Każdy świetlik ma własny rytm błysków (model Kuramoto). Gdy rój leci spokojnie, rytmy się sprzęgają i cały rój zaczyna pulsować razem. Rozbłysk w szczycie pulsu przy dobrej synchronizacji = **idealny**: koszt 10, zasięg ×1,5, premia punktowa. Każdy rozbłysk rozbija synchronizację.

## Rozbłysk

Zasięg ≈ 180 + 6·√(liczba świetlików). Uwalnia świetliki z pajęczyn i niszczy pajęczyny, płoszy nietoperze, od razu zapala lampiony, spycha Cień w dół.

## Obiekty

- **Larwy** — skupiska uśpionych świetlików; przelot obok budzi je i dołączają do roju. Gdy rój jest mały, larw jest więcej (łagodna pomoc).
- **Lampiony** — przytrzymaj przy nich ≥20 świetlików przez ~1 s (albo rozbłysk). Dają Blask, punkty, nutę melodii i miejsce odrodzenia.
- **Pajęczyny** — widoczne tylko w świetle. Łapią część przelatujących świetlików (pęka po ~40). Złapane gasną po 5 s, chyba że je uwolnisz rozbłyskiem.
- **Nietoperze** — zapowiedziane pierścieniem echa na brzegu ekranu, przelatują przez ekran i zjadają świetliki na swojej drodze. Rozbłysk je płoszy.
- **Cień** — podnosi się od dołu w stałym tempie, przyspiesza gdy jest daleko w tyle; świetliki w nim gasną.
- Kolejne biomy: żaby (język z zapowiedzią), rosiczki (fałszywe światło), deszcz, wiatr, sowa.

## Punkty

Wysokość (1 pkt / 10 j.), larwy (5), lampiony (100), idealny rozbłysk (25). Na końcu biomu premia za ocalałe świetliki.

## Struktura wyprawy

5 biomów po ~3 min, poziomy składane losowo z ręcznie zaprojektowanych fragmentów (ziarno wyprawy):

1. **Ściółka** — grzyby, pajęczyny, nietoperze w drugiej połowie. Samouczek w trakcie gry.
2. **Staw** — żaby, ważki, odbicia, mgła.
3. **Korony** — nietoperze, sowa, wiatr.
4. **Burza** — deszcz gasi, błyskawice oświetlają planszę.
5. **Nad chmurami** — zorza, finał: rój staje się konstelacją.

Trudność rośnie z biomem i w jego obrębie (węższe przejścia, więcej zagrożeń, mniej larw).

## Regrywalność

- Mutacje roju: między biomami wybór 1 z 3.
- **Twoje niebo**: każda ukończona wyprawa dodaje konstelację (kształt i jasność zależą od ocalałych).
- Gatunki świetlików: zielone, błękitne, bursztynowe, purpurowe — różne cechy.
- **Noce 1–10**: kolejne poziomy utrudnień po pierwszym przejściu.
- **Wyprawa dnia**: ziarno z daty.

## Stan

- Etap 1 zrobiony (prototyp Ściółki).
- Etap 2 zrobiony: wszystkie 5 biomów z własną grafiką, zagrożeniami i dźwiękiem, przejścia między biomami, finał z konstelacją (zapisywaną do przyszłego „Twojego nieba”). Strojenie trudności — później, po testach na telefonie.

## Etapy

1. **Prototyp** (teraz): rój, światło, biom Ściółka, larwy, lampiony, pajęczyny, nietoperze, Cień, rozbłysk z synchronizacją, podstawowy dźwięk.
2. Wszystkie biomy i zagrożenia, pełny dźwięk.
3. Mutacje, meta-postęp, niebo, Noce, wyprawa dnia, zapis stanu, PWA offline.
