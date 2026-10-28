# Koliko stane kilometer

An interactive take on the r/Slovenia chart "Koliko kilometrov za 100 evrov". The original was a static chart. This app answers the same question for any car on the ARSO list, or any older model in the ADAC Autokatalog, and adds what the chart left out: depreciation from real used-car prices, buying abroad and your own prices. The UI is in Slovenian. Live at https://even-gits.github.io/primerjava-vozil/.

It is a static page with no backend and no build step: `index.html`, `app.js`, `style.css` and two JSON data files in `data/`.

## What it computes

For each car you add (several cars can be compared side by side):

| Output | Formula |
|---|---|
| Energy per km | consumption (l or kWh per 100 km) × price ÷ 100. For a plug-in hybrid: share × electric + (1 − share) × fuel |
| km for 100 € (energy only, as in the original chart) | 100 ÷ energy per km |
| Resale value after *N* years | price × market(age + N) ÷ market(age), where market() is the median asking price curve for the same model **and fuel type**. For an EU import also × the SI/DE price ratio, because the car is resold in Slovenia. The user can type their own resale value instead |
| Value lost | price + import costs − resale value |
| Depreciation per km | value lost ÷ (km per year × N) |
| km for 100 € with depreciation | 100 ÷ (energy + depreciation per km) |

Inputs: make and model (searchable list; fuel type, consumption and CO2 prefilled and editable), drivetrain, fuel or charging type, purchase price, age at purchase, which market curve to use, km per year, years of ownership, and where you buy (Slovenia or EU import). Energy prices are global and editable. A car that is not on the list can be entered by hand: pick the drivetrain, type the consumption and price, and pick a similar model's curve or type a resale value.

### Value lost

Value lost comes from observed asking prices, not from a flat yearly percentage. For each model and each fuel group (petrol, diesel, electric, hybrid) there is a separate curve of median German asking prices by first-registration year. Between sampled years the app interpolates on a log scale. Outside the sampled ages it continues with that curve's own average yearly loss, and says so. EVs and hybrids use curves built only from their own ads. Next to every value-lost figure the app shows how many ads it rests on: in Germany (for the curve, with the count per model year) and in Slovenia (price level), plus the total. It flags small samples (under 60 ads or fewer than 4 model years) and extrapolation.

When a model and fuel group has fewer than 3 model years with at least 4 ads each, the app says so and uses the average curve of the same fuel group: the median year-on-year change across all curves of that group. It never borrows a curve from another fuel type.

Not included: insurance, the annual road charge, servicing, tyres and financing.

### EU import costs

When "Uvoz iz EU" is selected, the app adds the following and shows the breakdown:

- **DMV (davek na motorna vozila), ZDMV-1, in force since 1 Jan 2021.** The tax is a CO2 amount plus a EURO-class amount. The CO2 amount is 0 up to 50 g/km; above that it is the band minimum + a per-g/km surcharge, on separate petrol and diesel scales. Plug-in hybrids use the scale of their engine's fuel. NEDC figures are converted ×1.22 (petrol) or ×1.20 (diesel). The EURO amount is 10–1000 €. For a used vehicle, the tax is reduced by years since first registration: 91 % (under 1 year), 83 %, 76 %, 70 %, 64 %, 58 %, 53 %, 48 %, 43 %, 38 %, 33 % (over 10 years). EVs pay 0. The tables were copied from the official FURS calculator `DmvExcelKalkulator.xlsx` and checked against the law text. Not modelled: the 30 % reduction for 8+ seats or multipurpose vehicles.
- **Conformity check** (identification and technical assessment) at AMZS: 111.09 €.
- **Technical inspection** (passenger car up to 2.5 t, regulated price): 38.28 €.
- **Registration** (plates, registration document, fees): an editable estimate of 50 €. Providers do not publish one clear total.
- **Transport**: an editable estimate of 500 €. Enter your own quote.
- **VAT**: a car under 6 months old or under 6,000 km counts as new for VAT. You pay 22 % VAT in Slovenia on the net price. This is a checkbox.

## Data and sources (as of 28 Oct 2026)

| Data | Value | Source |
|---|---|---|
| WLTP consumption, CO2, power (cars on sale) | 3,100 variants | [ARSO list of new cars (June 2026)](https://www.gov.si/assets/organi-v-sestavi/ARSO/Podnebne-spremembe/Avtomobili/Seznam-modelov-novih-osebnih-avtomobilov-v-RS-WLTPm.xlsx) |
| Consumption of older and discontinued models | 901 variants of 75 model ranges, 285 generations (191 WLTP, 710 NEDC) | [ADAC Autokatalog](https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/) |
| Petrol 95 / diesel | 1.627 / 1.935 €/l (regulated, off motorways, 27 Oct–2 Nov 2026) | [gov.si](https://www.gov.si/novice/2026-10-26-od-jutri-nizje-cene-bencina-ter-visje-cene-dizla-in-kurilnega-olja/) |
| Petrol 100 / premium diesel / LPG | 1.956 / 2.379 / 1.016 €/l (median over stations) | [goriva.si](https://goriva.si/) public API, 550 stations |
| Home electricity | 0.1807 €/kWh (2025, band DD 5–15 MWh, all taxes) | [SURS 1817565S](https://pxweb.stat.si/SiStatData/pxweb/sl/Data/-/1817565S.px) |
| Public charging | AC 0.37, DC ≤50 kW 0.47, DC >50 kW 0.66 €/kWh (registered users) | [Petrol price list](https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje) |
| DMV | ZDMV-1 tables | [FURS](https://www.fu.gov.si/davki_in_druge_dajatve/podrocja/davek_na_motorna_vozila_dmv/), [calculator](https://edavki.durs.si/OpenPortal/Dokumenti/DmvExcelKalkulator.xlsx) |
| Conformity check, technical inspection | 111.09 €, 38.28 € | [AMZS conformity](https://www.amzs.si/storitve/pregledi-in-registracije/preverjanje-skladnosti-homologacija), [AMZS inspection](https://www.amzs.si/tehnicni-pregledi) |
| Value lost and market prices | see below | AutoScout24.de (DE), bolha.com (SI) |

**Market curves.** These come from AutoScout24.de search pages, country filter Germany, one result page (20 ads) per model, fuel group and first-registration year (1, 2, 3, 4, 5, 6, 8 and 10 years old). The GT86 was sampled for every production year. All passes ran on 28 Oct 2026. The first pass had no fuel filter (ages 1, 2, 3, 5, 7, 10). Later passes used the fuel filter: every electric and hybrid group, the petrol and diesel groups that were still thin, the petrol and diesel groups of 13 common models (`--groups=bd`), 12 older-fleet models, and the GR86 and GT86. For each model, fuel group and year, the fuel-filtered page is used when there is one; otherwise the first pass's ads of that fuel are used. Medians are made non-increasing with age (weighted pool-adjacent-violators): a rise between two model years, which is sampling noise, is pooled with its neighbours. AutoScout24 lists full and plug-in hybrids under the same fuels ("Elektro/Benzin", "Elektro/Diesel"), so they share one hybrid curve.

Result: 102 usable curves (21 of them electric) from 13,210 German ads. Six model and fuel combinations fall back to the average and say so: the Kodiaq and Duster hybrids, the 3008 and Elroq EVs and the GT86 have too few ads. Petrol Yaris ads are mostly the GR Yaris, so that curve is not used. The Toyota GR86 has its own curve from 38 ads at 2–4 years (15/16/7 per model year). It loses almost no value: medians of 37,610 € at 2 years and 36,990 € at 4. The GT86 has only 25 German ads (2 model years with 4 or more), so the app uses the petrol average for it and says so.

**Slovenian price level.** This is the median ratio of bolha.com ads (218 ads, first page per model, all fuels) to the German mixed-fuel medians at the same age. A per-model ratio is used with at least 8 Slovenian ads; otherwise the overall median (94.3 %) is used. bolha.com ads are mostly private sellers and AutoScout24 ads mostly dealers, which is likely why the ratio is under 100 %. All are asking prices, not sale prices. Mileage and trim are not controlled.

**Sites not used.** avto.net and mobile.de block automated reading (HTTP 403 bot check), so they were not used. Neither site was accessed past its block. doberavto.si loads its ads from `/internal-api/`, which robots.txt disallows, so it was not used either.

**Older cars.** ARSO lists only cars on sale new today. Older generations and discontinued models (for example the Toyota GT86/GR86) come from the ADAC Autokatalog. The sample covers 75 common model ranges and every generation still built in 2010 or later; Toyota also has generations from 2006. Each generation contributes one variant per distinct engine (fuel and kW), taken round-robin across fuel types so diesels and hybrids are included, with 3 to 8 engines per generation. Trims of the same engine are not repeated, so pick the closest engine and correct the consumption if needed. The EEA CO2 monitoring database was the other candidate, but its query service answered automated requests with HTTP 403, so it was not used. Each entry is labelled with its source and test cycle. NEDC consumption (cars before about 2018) is converted to WLTP the way the original post did, using the factors ZDMV-1 uses for CO2: ×1.22 for petrol (and hybrids, LPG and EVs) and ×1.20 for diesel. The CO2 value stays NEDC, and the DMV calculation applies the same factor. Full hybrids (HEV) are their own drivetrain; ARSO's "bencin/EE" class also includes them, and only rows with electric range or weighted values are treated as plug-ins.

## Refreshing the data

The data-collection scripts are not part of this repository. The method is described above, and the energy prices and import fees can be edited directly in `data/presets.json` (`energy`, `import`, `sources`).

## Follow-up ideas (not built)

- Automatic weekly fuel-price refresh from gov.si and goriva.si.
- Mixing home and public charging for one EV.
- A shareable URL that encodes the compared cars.
- Larger, mileage-aware price samples, separate curves per generation and for plug-in vs full hybrids.
- Slovenian price levels per fuel type (bolha.com is too thin today; avto.net blocks automated reading).
