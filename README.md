# AutoScout24 naar ANWB Autokosten (Safari Web Extension)

Een Safari Web Extension die automatisch occasions op **AutoScout24.nl** uitleest (kenteken, kilometerstand en vraagprijs) en doorstuurt naar de **ANWB Autokosten Calculator** (`anwb.nl/auto/autokosten/berekenen`) om direct de reële maandelijkse autokosten te berekenen.

---

## Functionaliteiten

1. **Automatische data-extractie op AutoScout24.nl:**
   - **Kenteken:** Herkent alle Nederlandse RDW sidecodes (1 t/m 14) via `__NEXT_DATA__`, JSON-LD gestructureerde data, specificatietabellen en advertentieteksten.
   - **Kilometerstand:** Automatisch uitgelezen en omgezet naar een zuiver getal (bijv. `24.500 km` ➔ `24500`).
   - **Vraagprijs:** Automatisch uitgelezen en omgezet (bijv. `€ 32.950,-` ➔ `32950`).

2. **On-Demand Activatie (Zero Performance Impact):**
   - Geen zware achtergrond-loops of `MutationObserver`s op AutoScout24; de website blijft 100% snel en responsief.
   - De data-extractie draait direct en binnen enkele milliseconden zodra je de extensie activeert via:
     - Het extensie-icoontje in de Safari-werkbalk.
     - Of via de subtiele zwevende badge (`🚗 ANWB Kosten`) rechtsonder op de pagina.
   - Toont direct de uitgelezen specificaties en laat je eventueel handmatig een kenteken intypen als de autoverkoper deze niet in de advertentietekst heeft gezet.

3. **Volautomatische ANWB Autokosten Calculator:**
   - Opent de ANWB-calculator (`https://www.anwb.nl/auto/autokosten/berekenen`) in een nieuw tabblad.
   - Sluit automatisch eventuele cookiebanners.
   - **Stap 1:** Vult het kenteken in en vraagt voertuigdata op.
   - **Stap 2:** Kiest automatisch de standaard uitvoering indien ANWB om een uitvoeringkeuze vraagt.
   - **Stap 3:** Vult de aankoop- en gebruiksgegevens in:
     - **Aanschafdatum:** Huidige maand en jaar (dynamisch berekend).
     - **Kilometerstand bij aanschaf:** Overgenomen van AutoScout24.
     - **Aanschafprijs:** Overgenomen van AutoScout24.
     - **Verwachte bezitsduur:** `8 jaar`.
     - **Kilometers per jaar:** `10.000 km`.
     - **Provincie (woonplaats):** `Noord-Holland`.
     - Standaardwaarden voor alle overige velden.
   - **Stap 4:** Navigeert naar het maandelijkse kostenoverzicht en toont de berekende maandkosten in een statusbalk bovenin het scherm!

---

## Safari Extensie Installeren & Testen

In recente Safari-versies (macOS Sonoma / Sequoia en Safari 17+) kun je de extensie direct als tijdelijke extensie inladen **zonder Xcode build-stappen**:

### Stap 1: Ontwikkelaarsfuncties aanzetten in Safari
1. Open **Safari**.
2. Open de instellingen via het menu: **Safari > Instellingen...** (of toetscombinatie `Cmd + ,`).
3. Klik op het tabblad **Geavanceerd** (*Advanced*).
4. Vink onderin het vakje aan: **"Toon functies voor webontwikkelaars"** (*Show features for web developers*).

### Stap 2: Niet-ondertekende extensies toestaan
1. Klik in Safari's instellingenvenster op het nieuwe tabblad **Ontwikkelaar** (*Developer*), of open het menu **Ontwikkel** in de macOS menubalk.
2. Schakel **"Niet-ondertekende extensies toestaan"** (*Allow Unsigned Extensions*) in (voer eventueel je macOS wachtwoord in ter bevestiging).

### Stap 3: Extensie toevoegen
1. Kies in het menu **Ontwikkel** (*Develop*) voor:
   **Voeg tijdelijke extensie toe...** (*Add Temporary Extension...*)
2. Selecteer deze projectmap:
   ```
   /Users/jortdejong/GitHub/car-cost-extension
   ```
   *(de map die het bestand `manifest.json` bevat)*
3. Klik op **Selecteer**.
4. De extensie is direct actief in Safari!

---

## Testen van de werking

1. Navigeer in Safari naar een AutoScout24 advertentiepagina, bijvoorbeeld:
   ```
   https://www.autoscout24.nl/aanbod/audi-q4-e-tron-35-s-edition-55-kwh-20-velgen-zwart-optiek-elektrisch-grijs-cat_ma9mo75830-bcb44279-e53b-4f7c-8525-4101947c6be0
   ```
2. Bekijk de **ANWB Autokosten** widget in de zijbalk / zwevend rechtsonder.
3. Controleer de automatisch uitgelezen gegevens (kenteken, km-stand, prijs).
4. Klik op **"📊 Bereken kosten op ANWB.nl"**.
5. Safari opent een nieuw tabblad met de ANWB rekentool.
6. Volg de voortgang via de blauwe ANWB statusbalk bovenin; de extensie doorloopt alle stappen automatisch tot het eindresultaat met de maandlasten verschijnt!

---

## Bestandsstructuur

```
car-cost-extension/
├── manifest.json              # Manifest V3 definitie voor Safari/WebExtensions
├── background.js              # Service worker voor tab- en message-beheer
├── utils/
│   ├── kenteken.js            # RDW sidecode validatie, opmaak en regex-extractie
│   └── dom-utils.js           # Robuuste SPA form helpers (React synthetic events)
├── content/
│   ├── autoscout.js           # Content script voor AutoScout24 pagina's
│   ├── autoscout.css          # Styling voor de in-page widget
│   ├── anwb.js                # Content script voor automatische ANWB formulieren
│   └── anwb.css               # Styling voor de top progress statusbalk
├── popup/
│   ├── popup.html             # Toolbar popup interface
│   ├── popup.js               # Popup logica en handmatige calculator
│   └── popup.css              # Popup styling
├── icons/                     # Extensie iconen (PNG 16, 32, 48, 128 + SVG)
├── scripts/
│   └── generate-icons.js      # Generator voor pixel-perfecte PNG iconen
├── test/
│   ├── test_kenteken.js       # Unit tests voor kenteken-detectie
│   └── test_extraction.js     # Tests voor scraping logica
└── package.json               # NPM scripts voor testen
```

---

## Lokale tests draaien

Je kunt de logica en extractie direct controleren via Node.js:
```bash
npm test
```
