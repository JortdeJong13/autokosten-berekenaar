# Autokosten Berekenaar

Een Safari-extensie die occasions op **AutoScout24.nl** uitleest (kenteken, kilometerstand en vraagprijs) en automatisch de **ANWB Autokosten Calculator** invult, zodat je in één klik de werkelijke maandlasten van een auto ziet.

<p align="center">
  <img src="docs/floating-panel.png" alt="De extensie op een AutoScout24-advertentiepagina" width="620">
</p>

> **Let op:** dit is een persoonlijk, onofficieel project. Het is niet verbonden aan, en wordt niet ondersteund door, AutoScout24 of ANWB. Zie [Disclaimer](#disclaimer).

---

## Wat het doet

1. **Leest de advertentie uit.** Kenteken, kilometerstand en vraagprijs worden van de AutoScout24-pagina gehaald. Kentekens worden herkend aan de hand van alle Nederlandse RDW-sidecodes (1 t/m 14), via `__NEXT_DATA__`, JSON-LD, specificatietabellen en de advertentietekst. De prijs wordt bewust *inclusief* BTW gekozen: ex-BTW- en doorgestreepte prijzen worden genegeerd.

2. **Twee identieke ingangen.** Een zwevende knop rechtsonder op de advertentiepagina, en het extensie-icoon in de Safari-werkbalk. Beide tonen exact hetzelfde formulier, zodat ze niet uit elkaar kunnen lopen.

3. **Instelbare uitgangspunten.** Bezitsduur, kilometers per jaar en provincie pas je direct in het formulier aan. Ze worden lokaal opgeslagen en bij de volgende berekening hergebruikt.

4. **Doorloopt de ANWB-rekentool.** De extensie vult het kenteken in, kiest de standaarduitvoering, zet de aanschafdatum op de huidige maand, en vult kilometerstand, aanschafprijs en jouw uitgangspunten in. Daarna word je doorgestuurd naar het resultaat met de maandelijkse kosten.

5. **Terugvaloptie op merk en model.** Staat er geen kenteken in de advertentie, of **herkent ANWB het kenteken niet**, dan schakelt de extensie over op ANWB's tabblad "Zoek op merk en model" en beschrijft de auto aan de hand van de advertentiegegevens: merk, model, bouwjaar, bouwmaand en — als ANWB daarom vraagt — brandstof en transmissie.

   Die tweede situatie komt voor bij auto's die nog niet in het RDW-register staan, bijvoorbeeld een verse import. ANWB antwoordt dan met een 404 en de melding *"Autogegevens ophalen mislukt"*. Zodra de extensie die melding ziet en de advertentie genoeg gegevens bevat, gaat ze automatisch verder op merk en model. Is er geen kenteken én te weinig advertentiegegevens, dan stopt ze met een duidelijke melding.

   De gegevens komen uit het JSON-LD `Car`-blok van de advertentie, dat structuur biedt in plaats van opmaak die kan veranderen. Alleen de brandstofsoort staat daar niet in; die komt uit `__NEXT_DATA__`.

   > **Let op:** AutoScout24 en ANWB noemen modellen niet hetzelfde. AutoScout24 zegt "GLC 300" waar ANWB "Glc-Klasse" heeft, en "318I" waar ANWB alleen "3-Serie" kent. Een verkeerde koppeling levert een plausibel maar onjuist bedrag op, dus bij een onzekere match meldt de statusbalk welke keuze is gemaakt, zodat je het kunt controleren. Lukt koppelen helemaal niet, dan stopt de automatisering met een duidelijke melding in plaats van te gokken.

6. **Schone bediening.** Elk veld dat de advertentie al beantwoordt, wordt verborgen: het kenteken zodra de auto bekend is (op de merk/model-route doet het niets meer), en kilometerstand en aanschafprijs zodra ze zijn uitgelezen. Wat de advertentie niet bevat, blijft staan zodat je het met de hand kunt invullen.

7. **Opties.** Op de merk/model-route vraagt ANWB welke opties op de auto zitten; die beïnvloeden de restwaarde. De extensie vinkt aan waarvoor de advertentie bewijs levert.

   Dat gebeurt bewust **niet** met een lijst per merk of model. Zo'n lijst zou verouderen zodra een van beide sites iets verandert, en de optielijst verschilt per auto. In plaats daarvan wordt de tekst van ANWB aan een **concept** gekoppeld, en dat concept wordt beantwoord met feiten over de advertentie:

   | ANWB | AutoScout24 |
   |---|---|
   | "Metallic lak" | het veld `paintType` (`Metallic` / `Solid`) |
   | een vraag over een dak | elk item in de uitrustingslijst dat op een dak wijst |

   Beide kanten blijven merkloos, dus dit werkt voor elke auto. Een test controleert dat er nergens een merknaam in de conceptlijst staat.

   Herkent de extensie een optie niet, dan blijft het vakje **uit**. Een onterecht aangevinkte optie verhoogt de waarde van de auto en daarmee het berekende bedrag, dus niets doen is de veiligere fout.

   De concepten zijn gebaseerd op een inventarisatie van ANWB's optielijsten via hun eigen `configurations`-API. Daaruit blijkt dat ANWB circa 33 opties prijst en dat de lijst per model verschilt. Ongeveer tien daarvan hebben een tegenhanger in de advertentiegegevens; de rest (alarm, getint glas, skiluik, lendesteun, armsteun, boordcomputer, koplampsproeiers, spiegels, xenon, verwarmde voorruit, radio/cd) wordt bewust met rust gelaten.

   Twee dingen om te weten:

   - **"STOELEN VERWARMED"** staat zo in ANWB's eigen data (een typefout voor *verwarmd*). De koppeling zoekt daarom op de woorden *stoel* én *verwarm*, in plaats van op die ene spelling. Dat sluit tegelijk **VERWARMDE VOORRUIT** (voorruit, geen stoel) en **ZIJRUITEN ELEKTRISCH** (ramen, geen stoel) uit — opties die anders onterecht zouden worden aangevinkt.
   - **"AUTOMATIC CLIMATE CONTROL"** wordt alleen aangevinkt bij *automatische* klimaatregeling. Een auto met alleen "Airconditioning" krijgt het vakje niet.

   De koppeling van het **schuifdak** is de minst zekere: AutoScout24 zegt alleen "Open dak", terwijl ANWB onderscheid maakt tussen een gewoon schuifdak en een elektrisch bediend exemplaar, met verschillende prijzen.

<p align="center">
  <img src="docs/popup.png" alt="Het extensieformulier in de Safari-werkbalk" width="300">
</p>

## Installeren

De extensie is niet ondertekend en staat niet in de App Store, dus je laadt hem in Safari als tijdelijke extensie.

### 1. Ontwikkelaarsfuncties aanzetten

1. Open **Safari** en ga naar **Safari › Instellingen…** (`⌘,`).
2. Open het tabblad **Geavanceerd**.
3. Vink **"Toon functies voor webontwikkelaars"** aan.

### 2. Niet-ondertekende extensies toestaan

1. Open in de menubalk het menu **Ontwikkel**.
2. Kies **"Niet-ondertekende extensies toestaan"** en bevestig met je wachtwoord.

### 3. Extensie laden

1. Kies in het menu **Ontwikkel** voor **"Voeg tijdelijke extensie toe…"**.
2. Selecteer de map met `manifest.json` (de hoofdmap van deze repo).
3. Klaar — de extensie is actief.

> Safari vergeet tijdelijke extensies zodra je hem afsluit. Na een herstart van Safari laad je hem opnieuw. Voor dagelijks gebruik kun je er beter een echte app van maken — zie hieronder.

### Een blijvende installatie maken

Met de tijdelijke-extensie-methode hierboven moet je de extensie na elke herstart van Safari opnieuw laden. Wil je dat niet, dan kun je deze repo omzetten in een echte macOS-app die Safari definitief installeert. Dat heeft twee voordelen: de extensie blijft staan, en je kunt **"Niet-ondertekende extensies toestaan"** daarna weer uitzetten.

Je hebt daar **volledige Xcode** voor nodig (niet alleen de Command Line Tools), omdat het `safari-web-extension-converter` gebruikt.

1. Installeer Xcode via de App Store, en zet daarna de toolchain goed:

   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   sudo xcodebuild -runFirstLaunch
   ```

2. Genereer het Xcode-project:

   ```bash
   ./scripts/make-safari-app.sh
   ```

3. Open het gegenereerde project, kies bij **Signing & Capabilities** je team (een gratis Apple ID is genoeg voor eigen gebruik), en druk op **Run** (`⌘R`).

4. Zet de extensie aan in **Safari › Instellingen › Extensies**.

Het Xcode-project komt **naast** deze repo te staan (in `../autokosten-berekenaar-safari`), niet erin. Dat is bewust: de converter scant de extensiemap op bestanden, en zijn eigen uitvoer daarin schrijven kan verwarring geven.

### Na een codewijziging

De converter kopieert de extensiebestanden **in** het Xcode-project. Een aanpassing in deze repo bereikt Safari dus niet vanzelf: `xcodebuild` bouwt opnieuw vanuit die kopie en kan met succes bouwen terwijl er nog oude code in zit.

Gebruik daarom:

```bash
npm run build:safari     # kopieert de gewijzigde bestanden en bouwt opnieuw
```

Daarna moet Safari volledig afsluiten (**⌘Q** — het sluiten van het venster is niet genoeg), want Safari bewaart extensiecode in de cache. Content scripts injecteren bovendien niet in tabbladen die al open staan, dus herlaad een openstaande advertentiepagina.

> De opzet met drie kopieën (repo, Xcode-project, gebouwde app) is een bewuste maar onhandige keuze: hij voorkomt dat `node_modules` in de extensie belandt, maar vraagt om die synchronisatiestap. Wie liever zonder die stap werkt, kan `--copy-resources` uit `scripts/make-safari-app.sh` halen, zodat het project direct naar de bestanden verwijst.

> **Verspreiden naar anderen** is een grotere stap: dan heb je een betaald Apple Developer-account nodig ($99 per jaar) om de app te ondertekenen en te notariseren. Zonder dat kunnen anderen de app niet zonder waarschuwing installeren.

## Gebruik

1. Open een advertentie op `autoscout24.nl/aanbod/…`.
2. Klik op **ANWB Kosten** rechtsonder, of op het extensie-icoon in de werkbalk.
3. Controleer de uitgelezen gegevens en pas zo nodig de uitgangspunten aan.
4. Klik op **Bereken op ANWB.nl**. Er opent een nieuw tabblad waarin de rekentool automatisch wordt doorlopen.

Staat het kenteken niet in de advertentie? Dan gaat het formulier gewoon door en zoekt ANWB de auto op **merk en model**. Het kentekenveld verdwijnt in dat geval: de auto is immers al bekend, dus je hoeft niets meer in te typen.

## Hoe het werkt

```
manifest.json          Manifest V3 (Safari / WebExtensions)
background.js          Service worker: tab- en message-beheer
utils/
  kenteken.js          RDW-sidecode validatie, opmaak en extractie
  dom-utils.js         React-bewuste formulierhulpjes voor de ANWB-tool
  calculator-form.js   Het gedeelde formulier (popup + zwevende knop)
  vehicle.js           Merk/model-koppeling voor de terugvaloptie
  options.js           Koppelt ANWB-optievragen aan advertentiegegevens
content/
  autoscout.js         Leest de advertentiepagina uit
  form.css             Styling van het gedeelde formulier
  autoscout.css        Styling van de zwevende knop
  anwb.js              Automatiseert de ANWB-rekentool
  anwb.css             Voortgangsbalk tijdens het automatiseren
popup/                 Werkbalk-popup (rendert hetzelfde formulier)
scripts/
  generate-icons.js    Genereert de PNG-iconen
  make-safari-app.sh   Zet de extensie om naar een echte macOS-app
  sync-to-safari.sh    Kopieert wijzigingen naar het Xcode-project en bouwt opnieuw
  fix-safari-project-signing.sh  Zet het ondertekeningsteam in het Xcode-project
test/                  Unit-, UI- en live end-to-end tests
```

> De twee oppervlakken delen niet alleen het formulier maar ook de opslag: de
> popup en de zwevende knop lezen en schrijven allebei `settings` en
> `pendingCalculation` in `chrome.storage.local`. Welk van de twee je opent,
> maakt voor het resultaat dus niet uit.

Een paar keuzes die het gedrag van de ANWB-tool verklaren, allemaal tegen de echte site geverifieerd:

- **React-bewaarde invoervelden.** De rekentool gebruikt React Hook Form. Alleen `.value` zetten en een `change`-event sturen is niet genoeg; de interne value tracker van React moet ook bijgewerkt worden. Dat regelt `setInputValue`.
- **De eerste klik wordt altijd afgewezen.** React Hook Form weigert een submit die binnenkomt terwijl het formulier nog aan het settelen is, ook als het veld al een geldige waarde heeft. Opnieuw klikken *zonder opnieuw te typen* lukt wel. Daarom vult de automatisering elk veld één keer en klikt daarna bij elke ronde opnieuw.
- **Velden verschijnen in golven.** Bezitsduur, kilometers per jaar en provincie bestaan pas in de DOM nadat jaar, maand, prijs en kilometerstand geldig zijn. De automatisering wacht daarom per veld tot het bestaat.
- **Niet elk veld is altijd een keuze.** ANWB vult "Soort transmissie" zelf in en zet het veld op slot als een model maar één versnellingsbak had. Is het veld wél actief, dan weigert ANWB de stap zonder antwoord (*"Selecteer een transmissie"*). De automatisering vult het daarom alleen als het echt gevraagd wordt, met de transmissie uit de advertentie.
- **De automatisering is een lus, geen vaste volgorde.** Ze kijkt welk scherm zichtbaar is en rondt dat af, zodat ze herstelt als ANWB een scherm overslaat (bijvoorbeeld als er maar één uitvoering is) of van volgorde verandert.

## Privacy

De extensie verstuurt niets naar de ontwikkelaar. Er is geen server, geen analytics en geen account. Alle gegevens blijven in je browser:

- Het kenteken, de kilometerstand en de prijs worden van de pagina gelezen en naar `anwb.nl` gestuurd, omdat de rekentool daar nu eenmaal om vraagt.
- Je uitgangspunten worden lokaal opgeslagen in `chrome.storage.local`, zodat je ze niet elke keer opnieuw hoeft in te vullen.
- Er worden geen gegevens verzameld, bewaard of gedeeld.

## Ontwikkelen

Vereist Node.js 18 of nieuwer.

```bash
npm install
npm test              # alles: unit + UI + live end-to-end
npm run test:unit     # snel en offline: kenteken, extractie, dom-utils, manifest
npm run test:ui       # laadt de echte popup en zwevende knop in WebKit
npm run test:e2e      # doorloopt de echte ANWB-rekentool in WebKit
```

De UI- en end-to-end tests draaien in **WebKit**, de engine van Safari, via Playwright. Daardoor testen ze gedrag dat er in Chrome net anders uitziet — bijvoorbeeld dat WebKit padding op een native `<select>` negeert.

De UI-tests laden de **echte** bestanden uit deze repo, niet een kopie. Ze controleren onder andere dat het manifest elk script laadt dat de code nodig heeft, dat alle formuliervelden even hoog zijn, en dat het openen van een tab goed gaat in alle drie de contexten (popup, content script, en een background die niet reageert).

`test/test_extraction_ev.mjs` draait tegen een bewaarde advertentiepagina. Ontbreekt die fixture, dan slaat de test zichzelf over; de instructie om hem opnieuw op te slaan staat bovenaan het bestand.

De end-to-end tests hebben netwerktoegang nodig en raken de echte ANWB-site. Ze zijn daarom niet geschikt voor CI. Er zijn er vijf: met kenteken, merk/model, een kenteken dat ANWB niet kent, een elektrische auto, en een auto met handgeschakelde transmissie.

> De kenteken-lookup van ANWB geeft met enige regelmaat een serverfout (504). De automatisering probeert het dan opnieuw, waardoor een berekening soms wat langer duurt.

## Disclaimer

Dit is een persoonlijk project en **geen officieel product**. Het is niet verbonden aan, goedgekeurd door of ondersteund door AutoScout24 of ANWB. Alle merknamen zijn eigendom van hun respectievelijke eigenaren.

De extensie leest pagina's van AutoScout24 en vult formulieren op anwb.nl in. Het automatiseren van een website kan in strijd zijn met de gebruiksvoorwaarden van die site. Gebruik het daarom voor je eigen, persoonlijke gebruik en met mate. De auteur is niet aansprakelijk voor eventuele gevolgen.

De berekende bedragen komen volledig van ANWB en zijn een indicatie. Controleer altijd de officiële cijfers voordat je een beslissing neemt.

## Licentie

[MIT](LICENSE)
