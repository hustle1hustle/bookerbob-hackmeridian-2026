# Demo queries

Ask Bob queries for the demo and the video, checked against `http://localhost:8080` on 2026-10-25T13:48Z with `scripts/demo-queries.ts`. Ranking is by proven reviews only.

## "hotel in lisbon under 120" 

parsed: kind hotel, max 120; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Casa Azulejo Nove (hotel) | places | 110 USDC | 4.4 from 8 proven stays, 3 verified |
| 2 | Belém Garden Inn (hotel) | places | 120 USDC | 4.7 from 3 proven stays, 1 verified |
| 3 | Alfama Sleep Rooms (hotel) | places | 70 USDC | 4.0 from 4 proven stays |
| 4 | Pátio do Vento (hotel) | places | 95 USDC | 3.7 from 6 proven stays, 1 verified |
| 5 | Graça Hill Hostel (hotel) | places | 45 USDC | 3.7 from 3 proven stays |

## "hotel under 100" 

parsed: kind hotel, max 100; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Alfama Sleep Rooms (hotel) | places | 70 USDC | 4.0 from 4 proven stays |
| 2 | Pátio do Vento (hotel) | places | 95 USDC | 3.7 from 6 proven stays, 1 verified |
| 3 | Graça Hill Hostel (hotel) | places | 45 USDC | 3.7 from 3 proven stays |

## "best hotel" 

parsed: kind hotel, max none; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Casa Azulejo Nove (hotel) | places | 110 USDC | 4.4 from 8 proven stays, 3 verified |
| 2 | Belém Garden Inn (hotel) | places | 120 USDC | 4.7 from 3 proven stays, 1 verified |
| 3 | Ribeira Slow House (hotel) | places | 140 USDC | 4.2 from 6 proven stays, 2 verified |
| 4 | Chiado Townhouse (hotel) | places | 180 USDC | 4.5 from 2 proven stays |
| 5 | Alfama Sleep Rooms (hotel) | places | 70 USDC | 4.0 from 4 proven stays |
| 6 | Pátio do Vento (hotel) | places | 95 USDC | 3.7 from 6 proven stays, 1 verified |

## "coffee nearby" 

parsed: kind cafe, max none; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Torra Coffee Lab (cafe) | places | 5 USDC | 4.7 from 3 proven visits |
| 2 | Café Lento (cafe) | places | 4 USDC | 4.3 from 3 proven visits, 1 verified |
| 3 | Pastelaria Nove (cafe) | places | 3 USDC | 3.7 from 3 proven visits |

## "restaurant dinner" 

parsed: kind restaurant, max none; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Mesa Atlântica (restaurant) | places | 45 USDC | 4.5 from 2 proven visits, 1 verified |
| 2 | Tasca do Rio (restaurant) | places | 25 USDC | 4.3 from 3 proven visits |
| 3 | Peixe & Brasa (restaurant) | places | 35 USDC | 3.5 from 2 proven visits |

## "t-shirt under 50 usdc" 

parsed: kind shop, max 50; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Azul Print Studio (shop) | places | 28 USDC | 4.5 from 2 proven purchases |
| 2 | Linho & Sal (shop) | places | 38 USDC | no proven reviews yet |
| 3 | REP ship of theseus tee (shop) | ucp | 40.8 USDC | no proven reviews yet |
| 4 | REP ship of theseus tee, bone (shop) | ucp | 40.8 USDC | no proven reviews yet |
| 5 | REP ship of theseus tee, white (shop) | ucp | 40.8 USDC | no proven reviews yet |

## "hoodie" 

parsed: kind shop, max none; sources: partners disabled, places ok, ucp ok

| # | result | source | price | why |
|---|---|---|---|---|
| 1 | Azul Print Studio (shop) | places | 28 USDC | 4.5 from 2 proven purchases |
| 2 | Linho & Sal (shop) | places | 38 USDC | no proven reviews yet |
| 3 | REP ship of theseus tee (shop) | ucp | 40.8 USDC | no proven reviews yet |
| 4 | REP hoodie, terminal black (shop) | ucp | 76.16 USDC | no proven reviews yet |
| 5 | REP hoodie, fog grey (shop) | ucp | 76.16 USDC | no proven reviews yet |
