# AutoScout24 naar ANWB Autokosten (Safari Web Extension)

Een Safari Web Extension die automatisch occasions op **AutoScout24.nl** uitleest (kenteken, kilometerstand en vraagprijs) en doorstuurt naar de **ANWB Autokosten Calculator** (`anwb.nl/auto/autokosten/berekenen`) om direct de reële maandelijkse autokosten te berekenen.

---

## Functionaliteiten

1. **Automatische data-extractie op AutoScout24.nl:**
   - **Kenteken:** herkent Nederlandse RDW-sidecodes (1 t/m 14) via `__NEXT_DATA__`, JSON-LD, specificatietabellen en advertentietekst.
   - **Kilometerstand** en **vraagprijs:** uitgelezen en omgezet naar een getal. De prijs wordt bewust *inclusief* BTW gekozen (ex-BTW- en doorgestreepte prijzen worden genegeerd).

2. **Twee identieke ingangen naar dezelfde calculator:**
   - De **zwevende knop** rechtsonder op een advertentiepagina.
   - Het **extensie-icoon** in de Safari-werkbalk.
   - Beide tonen exact hetzelfde formulier (`utils/calculator-form.js`), zodat ze niet uit elkaar kunnen lopen.

3. **Instelbare uitgangspunten:** bezitsduur, kilometers per jaar en provincie zijn direct in het formulier aan te passen. Ze worden opgeslagen in `chrome.storage.local` en bij de volgende berekening hergebruikt.

4. **Volautomatische ANWB Autokosten Calculator:**
   - Opent de ANWB-rekentool in een nieuw tabblad.
   - Doorloopt alle stappen: kenteken, uitvoering (standaardkeuze), aanschafdatum (huidige maand/jaar), kilometerstand, aanschafprijs en de gekozen uitgangspunten.
   - Toont de maandkosten in een statusbalk bovenin zodra het resultaat binnen is.

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
├── background.js              # Service worker: tab- en message-beheer
├── utils/
│   ├── kenteken.js            # RDW sidecode validatie, opmaak en extractie
│   ├── dom-utils.js           # React-bewuste form helpers voor de ANWB-tool
│   └── calculator-form.js     # Het gedeelde formulier (popup + zwevende knop)
├── content/
│   ├── autoscout.js           # Content script voor AutoScout24 pagina's
│   ├── autoscout.css          # Styling van de zwevende knop
│   ├── form.css               # Styling van het gedeelde formulier
│   ├── anwb.js                # Automatisering van de ANWB-rekentool
│   └── anwb.css               # Styling van de voortgangsbalk
├── popup/
│   ├── popup.html             # Werkbalk-popup (rendert het gedeelde formulier)
│   ├── popup.js               # Vult het formulier met gegevens van de actieve tab
│   └── popup.css              # Popup-specifieke styling
├── icons/                     # Extensie iconen
├── scripts/
│   └── generate-icons.js      # Generator voor PNG iconen
└── test/                      # Unit-, UI- en end-to-end tests
```

## Tests

```bash
npm test              # alles: unit + UI + live end-to-end
npm run test:unit     # snel, offline (kenteken, extractie, dom-utils, manifest)
npm run test:ui       # laadt de echte popup en zwevende knop in WebKit
npm run test:e2e      # doorloopt de echte ANWB-rekentool in WebKit
```

De UI- en end-to-end tests draaien in **WebKit** (de engine van Safari), zodat
gedrag overeenkomt met de browser waarin de extensie gebruikt wordt. De
end-to-end test heeft netwerktoegang nodig en raakt de echte ANWB-site.

> Let op: de kenteken-lookup van ANWB geeft soms een serverfout (504). De
> automatisering probeert het dan opnieuw; een enkele keer duurt het daardoor
> wat langer.
