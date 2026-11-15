# Ons huishouden

Een lokaal dashboard voor huishoudelijke taken en de planning per gezinslid.

## Starten

Start vanuit deze map een lokale webserver:

```sh
python3 -m http.server 8000
```

Open daarna <http://localhost:8000>. Er zijn geen externe dependencies nodig.
De eerste taken en gezinsleden komen uit de Excel-lijst in `data/`. Geboortedatums,
toewijzingen en planning zijn niet ingevuld waar de lijst die niet bevat.

Bij elk gezinslid kun je optioneel een geboortedatum invullen. De app toont
de leeftijd rekening houdend met de verjaardag; voor 29 februari is dat in
een niet-schrikkeljaar vanaf 1 maart. Als alleen een eerder opgegeven
geboortejaar bekend is, toont de app het verschil met het huidige jaar met
een vermelding dat de verjaardag onbekend is. Een eerder opgegeven leeftijd
blijft zichtbaar totdat je een geboortedatum invult.
Verjaardagen verschijnen jaarlijks met een taartje in de weekagenda, vanaf de
eerste verjaardag. Voor 29 februari verschijnt de verjaardag in een
niet-schrikkeljaar op 1 maart. Verjaardagen tellen niet mee als taken.

## Plannen

Klik op een taak in **Alle taken** om de planning te bewerken. Per ingepland
moment is één gezinslid verantwoordelijk:

- Dagelijks: kies per weekdag een gezinslid; een lege dag wordt overgeslagen.
- Wekelijks: kies een weekdag en afzonderlijk een gezinslid voor even en
  oneven ISO-weken. Laat een week leeg om die over te slaan.
- Maandelijks: kies een gezinslid en een dag van de maand. Ontbreekt die dag
  in een maand, dan wordt die maand overgeslagen.
- Sporadisch: kies een gezinslid en eventueel een datum.

Een taak zonder gezinslid of een sporadische taak zonder datum staat wel in de
takenlijst, maar niet op de kalender. Afvinken geldt voor de afzonderlijke
geplande datum. Bestaande planningen worden automatisch overgenomen.
In **Alle taken** geeft het label **Ingepland** of **Niet ingepland** aan of
minstens één moment met een gezinslid is ingesteld. Een sporadische taak met
een datum in het verleden blijft als ingepland aangeduid.
Filter op planningsstatus via **Alle statussen** of klik op de kolomkop
**Status** om de volgorde om te keren.

Eerder samengevoegde taken behouden hun schema's en afvinkjes. Hun schema's
kun je via **bewerken** afzonderlijk aanpassen; bij overlap heeft het eerste
passende schema voorrang.

Wijzigingen worden alleen in de lokale browseropslag bewaard: ze worden niet
gesynchroniseerd met andere apparaten of gebruikers en kunnen verdwijnen als
browsergegevens worden gewist. De app heeft geen login of gedeelde server.

## Back-up

Via **Back-up** kun je handmatig een JSON-bestand downloaden met gezinsleden,
taken, planningen en afvinkjes. Bewaar dit bestand veilig: het bevat persoonlijke
gegevens. De instelling voor lichte of donkere modus staat niet in de back-up.

Kies op dezelfde pagina een eerder gedownload bestand en klik op **Back-up
terugzetten**. Na bevestiging worden de huidige gegevens in deze browser
vervangen, niet samengevoegd. Maak eventueel eerst een back-up van de huidige
gegevens. Een back-up wordt niet automatisch gemaakt of bijgewerkt.

## Weergave

Met de knop **Donker** bovenaan schakel je donkere modus in. Met **Licht**
schakel je terug. Je keuze wordt afzonderlijk in de lokale browser bewaard.

## TODO
- voor bewerken van dashboard is een login nodig
- optie voor boodschappen, als iets op is of iemand wil iets dan kan die dat toevoegen

## Niet doen
- beheer van familieleden enkel door ouders, elk lid heeft een rol: kind of ouder
- samenvoegen van taken, onnodig complex en weinig meerwaarde
- elk gezinslid krijgt een eigen kijk op het dashboard met een persoonlijke weekplanning en herinneringen voor taken

## Nog te bekijken
- app publiek zetten en bv hosten via alwaysdata
- this will require users to create a login if everything is public + manage a family
- android app nodig? 