# THE DESTINY OF POWER

Browserbasiertes Strategiespiel in JavaScript. Die Spielidee: Der Spieler waehlt ein reales Land der Welt und versucht, ueber Politik, Wirtschaft, Diplomatie und Militaer globale Macht zu erlangen.

## Projektstruktur

```text
THE DESTINY OF POWER/
|- public/
|  |- styles/
|  |  \- main.css
|  \- world-data/
|- src/
|  |- config/
|  |- core/
|  |- data/
|  |  \- countries/
|  |- modules/
|  |  |- diplomacy/
|  |  |- economy/
|  |  |- military/
|  |  |- politics/
|  |  |- ui/
|  |  \- world/
|  \- utils/
|- docs/
|- assets/
|  |- audio/
|  |- images/
|  \- icons/
\- tests/
   |- integration/
   \- unit/
```

## Start

```bash
npm install
npm run dev
```

## Architekturidee

- `src/core`: Spielstart, Schleife, globaler Zustand.
- `src/modules/world`: Weltkarte, Laender, Grenzen, Besitzverhaeltnisse.
- `src/modules/politics`: Einfluss, Stabilitaet, Regierungssysteme.
- `src/modules/economy`: Einkommen, Rohstoffe, Handel.
- `src/modules/military`: Truppen, Staerke, Konflikte.
- `src/modules/diplomacy`: Beziehungen, Buendnisse, Sanktionen.
- `src/modules/ui`: Bildschirmaufbau und Menues.
- `src/data/countries`: Reale Laenderdaten.
- `docs`: Design- und Balancing-Notizen.