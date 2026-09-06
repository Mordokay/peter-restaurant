# Import report — dry run

Source: `/Users/pedrosaldanha/Downloads/3D` · 25 files · **243 objects to import**, 174 skipped, 7 flagged for a look. Nothing has been converted. Edit `scripts/import-overrides.json` (names, scales, merges, skips, folders) and re-run `node scripts/import-plan.mjs` until this reads right; then `node scripts/import-batch.mjs` converts everything in `.art-assets/import-plan.json`.

Columns: **id** is the catalog id (a `→` shows the id after a clash rename), **h** the height in the game after unit scaling, **parts** how many meshes make the object, **tri** the source triangles. Tags come from the keyword rules and can be corrected in the lab afterwards.

## Packs at a glance

| pack | meshes → objects | units | folder | note |
|---|---|---|---|---|
| 28_free_objects | 30 → 25 (+5 skipped) | mixed — every object gets its own height | `props/free_objects` | Scanned/kit-bashed free objects with inconsistent scale (a chair is 5.6 units, a fork 0.06). Each kept object gets an explicit real-world height. Storage crates, pallets, shelving and the pergola are useful for receiving and the yard; the tools are duplicates of better ones and are skipped. |
| black_metal_vintage_restaurant_chair | 13 → 1 | metres | `dining/seating` | 13 meshes are one chair (frame, seat, rings). Imported as one object at 85 cm. |
| cartoon__wooden__farm__pack | 30 → 29 (+1 skipped) | oversized ×2.5 → scaled to 0.4 | `farm/cartoon_wood` | Chunky cartoon farm set: barrels, stumps, crates, tubs, fence walls, a bench, a table, a street lamp, watermelons and squashes. Scaled so the fence sections are 1.1 m and a barrel 84 cm. |
| cleaning_cart | 1 → 1 | decimetre-ish (7.75 raw) → 1.0 m cart | `kitchen/cleaning` | One janitor cart with bucket, mop and bins. 22k triangles. |
| elegant_dinner_set | 30 → 16 | metres | `dining/tableware_elegant` | Green-and-gold ceramic set, very high poly (692k triangles — the plates alone are 100k+). Names in the file are messy; mapped by shape. |
| farm_-_low_poly_moduler_pack | 86 → 40 | metres | `farm/modular` | Well-named modular farm kit: dirt plots (dry/green/tall/flat/watered), grass tufts, rocks, mossy logs, trees, hay bale, barrel, buckets, fence, broken fence, gate, water pole, laundry line, three tractors. Ids keep the pack names in snake_case. |
| farm_set_part_3 | 5 → 5 | centimetres | `farm/tools` | Five hand tools: broomstick, spade, hoe, saw, rake (1–1.3 m). Textures are light — check colour after conversion. |
| folding_table | 1 → 1 | metres | `dining/tables` | One plastic folding table, 80 cm high, 1.95 m long. |
| fruits_pack | 117 → 0 (+117 skipped) | inches (SketchUp) → ×0.0254 | `food/market_displays` | Skipped by the owner — will be removed from the folder. |
| hanging_branch_of_dried_bay_leaves_for_cooking | 4 → 1 | centimetres | `decor/hanging` | One hanging bundle, 93 cm. Made of scattered leaf cards — the voxel version will be a loose cloud; check it reads. |
| hanging_plants_001 | 6 → 3 | millimetres | `decor/plants` | Three copies of the same trailing plant (stem + leaves). Each pair becomes one 1.85 m hanging plant; the file has no pot. |
| hanging_pothos | 20 → 1 (+10 skipped) | centimetres | `decor/plants` | The 'Constructed Sample' is the finished plant (pot, string, vines); the loose stems, leaves and samples are its building blocks and are skipped. |
| house_plants_hanging_pot | 7 → 1 | centimetres | `decor/plants` | One hanging pot plant (pot + foliage), 22 cm — small; 405k triangles. |
| indoor_plants | 18 → 4 | metres | `decor/plants` | Four potted house plants (peace lily, monstera, rubber plant, aloe in its pot). 189k triangles, realistic style. |
| kitchen_-_assets | 48 → 28 | metres | `kitchen/kitchen_assets` | Realistic kitchen kit whose objects come in parts. Parts are merged: sink (basin, legs, drain, faucet), portable stove (base, burners, grates, tumbler, wire), gas cylinders with taps, jars and cans with lids, stew pot with lid, cooking table (top, shelf, legs, bolts), pot rack (rack, rails, hooks). |
| kitchen_appliances | 25 → 23 | oversized ×3 → scaled to 0.33 | `kitchen/utensils_cartoon` | Chunky cartoon utensils (a 1.35 m rolling pin in the file). Scaled to real sizes: rolling pin 45 cm, ladle 42 cm, big pan 47 cm. The two 'Cube' meshes are knives; the grill and the baking form come in two halves and are merged. |
| lamp_02_lowpoly | 1 → 1 | metres | `dining/lighting` | One hanging pendant lamp, 1.25 m including the cord. |
| low_poly_farm_v2 | 22 → 0 (+22 skipped) | toy scale ×2 → scaled to 0.5 | `farm/animals_and_buildings` | Skipped by the owner — will be removed from the folder. |
| modular_plant_shelf | 11 → 11 | metres | `decor/plant_shelf` | A modular wall plant shelf: shelf modules, connectors, wall holder, and four sample plants (spinach, rutabaga, carrot, flowers) that can be placed on it. |
| shelf | 5 → 1 | metres | `kitchen/shelving` | One three-tier shelf unit (metal frame + three wooden boards). 98 cm. |
| stainless_steel_shelving_restaurant_equipment | 3 → 1 | inches (SketchUp) → ×0.0254 | `kitchen/shelving` | One five-tier restaurant shelving unit, 84 in = 2.13 m. |
| steel_table | 2 → 1 | millimetres | `kitchen/equipment` | One stainless prep table with undershelf, 2.0 m long, 85 cm high. |
| stylized_farm_objects_mobile_game_ready | 19 → 0 (+19 skipped) | metres | `farm` | Already in the catalog (farm/tools, fences, crates, nature) — nothing to do. |
| stylized_medieval_props | 35 → 32 | slightly small → ×1.3 | `outdoor/rustic_props` | Rustic props that fit the farm-to-table look: tables, chair, barrels, crates, fences, hay, a well, a wagon, a ladder, climbing vines, flowers, foliage. Scaled so the table is 58 cm and the chair 77 cm. |
| trash_can_package_02 | 17 → 17 | tiny raw units (0.02–0.06) → ×30 so bins are 0.6–1.8 m | `kitchen/waste` | 17 scanned bins and containers (very high poly, 25–40k triangles each). Scaled to bin size; check the biggest two (TrashCan_19, TrashCan_13) which come out 1.3–1.8 m. |

## 28_free_objects

`28_free_objects.glb` · 30 meshes · 22,726 triangles · file extent 18.99 × 7.78 × 22.72 (raw units) · scale ×1 (mixed — every object gets its own height) · folder `props/free_objects`

> Scanned/kit-bashed free objects with inconsistent scale (a chair is 5.6 units, a fork 0.06). Each kept object gets an explicit real-world height. Storage crates, pallets, shelving and the pergola are useful for receiving and the yard; the tools are duplicates of better ones and are skipped.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `metal_shelving_unit` | Metal Shelving Unit | 1.80 m | 1 | 180 | kitchen |  |
| `metal_cabinet` | Metal Cabinet | 1.60 m | 1 | 406 | kitchen, storage |  |
| `storage_container_low` | Storage Container Low | 80 cm | 1 | 356 | kitchen, storage |  |
| `storage_container_tall` | Storage Container Tall | 1.40 m | 1 | 208 | kitchen, storage |  |
| `storage_container_tall_2` | Storage Container Tall 2 | 1.40 m | 1 | 372 | kitchen, storage |  |
| `pallet` | Pallet | 15 cm | 1 | 482 | kitchen |  |
| `storage_container_box` | Storage Container Box | 60 cm | 1 | 138 | kitchen, storage |  |
| `steel_frame_table` | Steel Frame Table | 90 cm | 1 | 196 | dining, furniture, decor | → `dining/tables` |
| `hand_truck` | Hand Truck | 1.10 m | 1 | 332 | kitchen |  |
| `bistro_chair` | Bistro Chair | 90 cm | 1 | 662 | dining, seating, furniture | → `dining/seating` |
| `pallet_flat` | Pallet Flat | 15 cm | 1 | 120 | kitchen |  |
| `pergola` | Pergola | 2.40 m | 1 | 928 | kitchen | → `outdoor/structures` |
| `pallet_small` | Pallet Small | 15 cm | 1 | 92 | kitchen |  |
| `folding_chair` | Folding Chair | 85 cm | 1 | 948 | dining, seating, furniture | → `dining/seating` |
| `water_bottle_large` | Water Bottle Large | 50 cm | 1 | 332 | kitchen, ingredient, storage |  |
| `plastic_crate` | Plastic Crate | 35 cm | 1 | 590 | kitchen, storage |  |
| `resten_objeckter_001` | Resten Objeckter 001 | 1.30 m | 1 | 264 | kitchen |  |
| `wash_tub` | Wash Tub | 30 cm | 1 | 436 | kitchen |  |
| `storage_box` | Storage Box | 40 cm | 1 | 124 | kitchen, storage |  |
| `storage_box_2` | Storage Box 2 | 40 cm | 1 | 124 | kitchen, storage |  |
| `storage_box_3` | Storage Box 3 | 40 cm | 1 | 124 | kitchen, storage |  |
| `cable_reel` | Cable Reel | 1.00 m | 1 | 244 | kitchen |  |
| `globe` | Globe | 40 cm | 1 | 10,716 | kitchen | → `decor/office` |
| `round_tub` | Round Tub | 60 cm | 1 | 2,172 | kitchen |  |
| `wooden_chair_scan` | Wooden Chair Scan | 90 cm | 1 | 1,032 | dining, seating, furniture | → `dining/seating` |

Skipped: `Cube.024_0` (gloves — flat scan, poor voxel), `Cube.025_0` (spade — we have shovel/spade), `Cube.026_0` (pruner — too thin), `Cube.027_0` (spoon — duplicates), `Cube.028_0` (fork — duplicates)

## black_metal_vintage_restaurant_chair

`black_metal_vintage_restaurant_chair.glb` · 13 meshes · 5,316 triangles · file extent 0.53 × 0.72 × 0.53 (raw units) · scale ×1 (metres) · folder `dining/seating`

> 13 meshes are one chair (frame, seat, rings). Imported as one object at 85 cm.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `vintage_metal_chair` | Vintage Metal Chair | 85 cm | 13 | 5,316 | dining, seating, furniture | 13 parts merged |

## cartoon__wooden__farm__pack

`cartoon__wooden__farm__pack.glb` · 30 meshes · 5,304 triangles · file extent 26.76 × 8.84 × 26.76 (raw units) · scale ×0.4 (oversized ×2.5 → scaled to 0.4) · folder `farm/cartoon_wood`

> Chunky cartoon farm set: barrels, stumps, crates, tubs, fence walls, a bench, a table, a street lamp, watermelons and squashes. Scaled so the fence sections are 1.1 m and a barrel 84 cm.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `garden_table` | Garden Table | 75 cm | 1 | 164 | kitchen, furniture | → `outdoor/furniture` |
| `deck_planks_3` | Deck Planks 3 | 12 cm | 1 | 164 | farm, outdoor |  |
| `street_lamp_wood` | Street Lamp Wood | 3.54 m | 1 | 68 | dining, decor | → `outdoor/lighting` · ⚠️ very tall — check units |
| `fence_wall_3` | Fence Wall 3 | 1.12 m | 1 | 248 | farm, outdoor, fence, structure |  |
| `fence_wall_2` | Fence Wall 2 | 1.12 m | 1 | 248 | farm, outdoor, fence, structure |  |
| `fence_wall_post` | Fence Wall Post | 1.12 m | 1 | 248 | farm, outdoor, fence, structure |  |
| `fence_wall` | Fence Wall | 1.12 m | 1 | 248 | farm, outdoor, fence, structure |  |
| `garden_bench` | Garden Bench | 1.14 m | 1 | 164 | dining, seating, furniture | → `outdoor/furniture` |
| `crate_cartoon` | Crate Cartoon | 1.23 m | 1 | 192 | farm, outdoor, storage |  |
| `crate_cartoon_small` | Crate Cartoon Small | 73 cm | 1 | 192 | farm, outdoor, storage |  |
| `deck_planks_2` | Deck Planks 2 | 12 cm | 1 | 164 | farm, outdoor |  |
| `deck_planks` | Deck Planks | 12 cm | 1 | 164 | farm, outdoor |  |
| `wooden_ladder` | Wooden Ladder | 1.17 m | 1 | 164 | farm, outdoor |  |
| `crate_cartoon_2` | Crate Cartoon 2 | 1.23 m | 1 | 192 | farm, outdoor, storage |  |
| `barrel_cartoon_2` | Barrel Cartoon 2 | 62 cm | 1 | 278 | farm, outdoor, storage |  |
| `wooden_tub_3` | Wooden Tub 3 | 63 cm | 1 | 76 | farm, outdoor |  |
| `wooden_tub_2` | Wooden Tub 2 | 63 cm | 1 | 76 | farm, outdoor |  |
| `wooden_tub` | Wooden Tub | 63 cm | 1 | 76 | farm, outdoor |  |
| `stump_2` | Stump 2 | 64 cm | 1 | 224 | farm, outdoor, decor |  |
| `stump` | Stump | 54 cm | 1 | 224 | farm, outdoor, decor |  |
| `stump_short` | Stump Short | 44 cm | 1 | 224 | farm, outdoor, decor |  |
| `stump_tall` | Stump Tall | 72 cm | 1 | 224 | farm, outdoor, decor |  |
| `barrel_cartoon` | Barrel Cartoon | 84 cm | 1 | 278 | farm, outdoor, storage |  |
| `squash_cartoon_3` | Squash Cartoon 3 | 33 cm | 1 | 140 | kitchen, food | → `food/cartoon_produce` · detail ultra |
| `squash_cartoon_2` | Squash Cartoon 2 | 40 cm | 1 | 218 | kitchen, food | → `food/cartoon_produce` · detail ultra |
| `squash_cartoon` | Squash Cartoon | 33 cm | 1 | 140 | kitchen, food | → `food/cartoon_produce` · detail ultra |
| `watermelon_cartoon_2` | Watermelon Cartoon 2 | 53 cm | 1 | 140 | kitchen, food, ingredient | → `food/cartoon_produce` · detail ultra |
| `watermelon_cartoon` | Watermelon Cartoon | 60 cm | 1 | 140 | kitchen, food, ingredient | → `food/cartoon_produce` · detail ultra |
| `stump_3` | Stump 3 | 54 cm | 1 | 224 | farm, outdoor, decor |  |

Skipped: `Plane` (ground plane)

## cleaning_cart

`cleaning_cart.glb` · 1 meshes · 22,636 triangles · file extent 3.33 × 7.75 × 5.75 (raw units) · scale ×0.13 (decimetre-ish (7.75 raw) → 1.0 m cart) · folder `kitchen/cleaning`

> One janitor cart with bucket, mop and bins. 22k triangles.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `cleaning_cart` | Cleaning Cart | 1.00 m | 1 | 22,636 | kitchen, storage, tool, furniture | 1 parts merged |

## elegant_dinner_set

`elegant_dinner_set.glb` · 30 meshes · 691,946 triangles · file extent 0.79 × 0.20 × 0.82 (raw units) · scale ×1 (metres) · folder `dining/tableware_elegant`

> Green-and-gold ceramic set, very high poly (692k triangles — the plates alone are 100k+). Names in the file are messy; mapped by shape.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `knife_elegant` | Knife Elegant | 2 cm | 3 | 5,024 | kitchen, prep, tool | detail ultra |
| `serving_lid_elegant` | Serving Lid Elegant | 9 cm | 2 | 30,976 | kitchen, cooking | detail ultra |
| `serving_bowl_elegant` | Serving Bowl Elegant | 6 cm | 2 | 39,936 | dining, tableware | detail ultra |
| `serving_bowl_deep_elegant` | Serving Bowl Deep Elegant | 11 cm | 2 | 7,936 | dining, tableware | detail ultra |
| `small_bowl_elegant` | Small Bowl Elegant | 5 cm | 2 | 13,056 | dining, tableware | detail ultra |
| `small_bowl_elegant_2` | Small Bowl Elegant 2 | 5 cm | 2 | 14,592 | dining, tableware | detail ultra |
| `serving_spoon_elegant` | Serving Spoon Elegant | 2 cm | 2 | 76,965 | kitchen, prep, tool | detail ultra |
| `ladle_elegant` | Ladle Elegant | 2 cm | 2 | 11,520 | kitchen, prep, tool | detail ultra |
| `soup_spoon_elegant` | Soup Spoon Elegant | 2 cm | 1 | 11,264 | dining, food, prep, tool | detail ultra |
| `napkin_ring_gold` | Gold Napkin Ring | 2 cm | 1 | 256 | dining, decor | detail ultra |
| `teaspoon_elegant` | Teaspoon Elegant | 2 cm | 1 | 66,405 | kitchen | detail ultra |
| `spoon_ceramic_elegant` | Spoon Ceramic Elegant | 2 cm | 1 | 10,560 | kitchen, prep, tool | detail ultra |
| `square_plate_elegant` | Square Plate Elegant | 2 cm | 3 | 184,320 | dining, tableware | ⚠️ 184k triangles — slow to convert |
| `tray_elegant` | Tray Elegant | 2 cm | 2 | 20,736 | kitchen, prep | detail ultra |
| `dinner_plate_elegant` | Dinner Plate Elegant | 2 cm | 2 | 116,736 | dining, tableware |  |
| `fork_elegant` | Fork Elegant | 2 cm | 2 | 81,664 | kitchen, prep, tool | detail ultra |

## farm_-_low_poly_moduler_pack

`farm_-_low_poly_moduler_pack.glb` · 86 meshes · 65,056 triangles · file extent 21.19 × 6.67 × 69.99 (raw units) · scale ×1 (metres) · folder `farm/modular`

> Well-named modular farm kit: dirt plots (dry/green/tall/flat/watered), grass tufts, rocks, mossy logs, trees, hay bale, barrel, buckets, fence, broken fence, gate, water pole, laundry line, three tractors. Ids keep the pack names in snake_case.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `barrel_wood` | Barrel Wood | 99 cm | 2 | 268 | farm, outdoor, storage |  |
| `bucket` | Bucket | 61 cm | 2 | 380 | farm, outdoor, tool |  |
| `plot_dirt_dry` | Plot Dirt Dry | 74 cm | 2 | 3,132 | farm, outdoor, decor |  |
| `plot_dirt_flat` | Plot Dirt Flat | 74 cm | 1 | 2,754 | farm, outdoor, decor |  |
| `plot_dirt_tall_dry` | Plot Dirt Tall Dry | 2.30 m | 3 | 4,604 | farm, outdoor, decor |  |
| `plot_dirt_tall_green` | Plot Dirt Tall Green | 2.30 m | 3 | 4,604 | farm, outdoor, decor |  |
| `plot_dirt_short_green` | Plot Dirt Short Green | 1.23 m | 3 | 4,582 | farm, outdoor, decor |  |
| `plot_dirt_small_dry` | Plot Dirt Small Dry | 1.29 m | 3 | 4,612 | farm, outdoor, decor |  |
| `plot_dirt_watered` | Plot Dirt Watered | 64 cm | 3 | 2,756 | farm, outdoor, decor |  |
| `fence_rail` | Fence Rail | 1.20 m | 2 | 252 | farm, outdoor, fence, structure |  |
| `fence_rail_broken` | Fence Rail Broken | 1.20 m | 2 | 256 | farm, outdoor, fence, structure |  |
| `gate_wood` | Gate Wood | 3.43 m | 1 | 1,040 | farm, outdoor, fence, structure | ⚠️ very tall — check units |
| `grass_patch_dry` | Grass Patch Dry | 91 cm | 1 | 10,000 | farm, outdoor, plant, decor |  |
| `grass_patch_green` | Grass Patch Green | 91 cm | 1 | 10,000 | farm, outdoor, plant, decor |  |
| `grass_tuft` | Grass Tuft | 1.95 m | 1 | 10 | farm, outdoor, plant, decor |  |
| `grass_tuft_dry` | Grass Tuft Dry | 1.95 m | 1 | 10 | farm, outdoor, plant, decor |  |
| `hay_bale_round` | Hay Bale Round | 1.11 m | 4 | 236 | farm, outdoor, decor |  |
| `laundry_line` | Laundry Line | 2.32 m | 5 | 936 | farm, outdoor |  |
| `log` | Log | 81 cm | 1 | 378 | farm, outdoor, decor |  |
| `log_moss_dry` | Log Moss Dry | 81 cm | 2 | 474 | farm, outdoor, decor |  |
| `log_moss_green` | Log Moss Green | 81 cm | 2 | 474 | farm, outdoor, decor |  |
| `plant_bush` | Plant Bush | 68 cm | 1 | 224 | farm, outdoor, plant, decor |  |
| `plant_bush_dry` | Plant Bush Dry | 68 cm | 1 | 224 | farm, outdoor, plant, decor |  |
| `rock_1` | Rock 1 | 1.27 m | 1 | 74 | farm, outdoor, decor |  |
| `rock_2` | Rock 2 | 1.30 m | 1 | 72 | farm, outdoor, decor |  |
| `rock_3` | Rock 3 | 87 cm | 1 | 86 | farm, outdoor, decor |  |
| `rock_dry_1` | Rock Dry 1 | 1.27 m | 2 | 74 | farm, outdoor, decor |  |
| `rock_dry_2` | Rock Dry 2 | 1.30 m | 2 | 72 | farm, outdoor, decor |  |
| `rock_dry_3` | Rock Dry 3 | 87 cm | 2 | 86 | farm, outdoor, decor |  |
| `rock_moss_1` | Rock Moss 1 | 1.27 m | 2 | 74 | farm, outdoor, decor |  |
| `rock_moss_2` | Rock Moss 2 | 1.30 m | 2 | 72 | farm, outdoor, decor |  |
| `rock_moss_3` | Rock Moss 3 | 87 cm | 2 | 86 | farm, outdoor, decor |  |
| `tractor_green` | Tractor Green | 2.77 m | 3 | 3,056 | farm, outdoor |  |
| `tractor_red` | Tractor Red | 2.77 m | 3 | 3,056 | farm, outdoor |  |
| `tractor_yellow` | Tractor Yellow | 2.77 m | 3 | 3,056 | farm, outdoor |  |
| `tree_pine_1` | Tree Pine 1 | 3.92 m | 2 | 646 | farm, outdoor, plant, decor | ⚠️ very tall — check units |
| `tree_pine_2` | Tree Pine 2 | 3.92 m | 2 | 646 | farm, outdoor, plant, decor | ⚠️ very tall — check units |
| `tree_log` | Tree Log | 75 cm | 4 | 558 | farm, outdoor, plant, decor |  |
| `bucket_water` | Bucket Water | 61 cm | 3 | 408 | farm, outdoor, ingredient, tool |  |
| `water_pole` | Water Pole | 6.52 m | 4 | 728 | farm, outdoor, ingredient | ⚠️ very tall — check units |

## farm_set_part_3

`farm_set_part_3.glb` · 5 meshes · 27,079 triangles · file extent 176.64 × 131.51 × 53.33 (raw units) · scale ×0.01 (centimetres) · folder `farm/tools`

> Five hand tools: broomstick, spade, hoe, saw, rake (1–1.3 m). Textures are light — check colour after conversion.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `rake` | Rake | 1.03 m | 1 | 2,095 | farm, outdoor, tool |  |
| `hand_saw` | Hand Saw | 14 cm | 1 | 760 | farm, outdoor |  |
| `hoe_wood` | Hoe Wood | 99 cm | 1 | 1,968 | farm, outdoor, tool |  |
| `spade` | Spade | 1.29 m | 1 | 2,340 | farm, outdoor |  |
| `broom` | Broom | 1.23 m | 1 | 19,916 | farm, outdoor |  |

## folding_table

`folding_table.glb` · 1 meshes · 5,556 triangles · file extent 1.95 × 0.81 × 0.79 (raw units) · scale ×1 (metres) · folder `dining/tables`

> One plastic folding table, 80 cm high, 1.95 m long.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `folding_table` | Folding Table | 81 cm | 1 | 5,556 | kitchen, furniture | 1 parts merged |

## fruits_pack

`fruits_pack.glb` · 117 meshes · 1,233,733 triangles · file extent 279.36 × 20.95 × 353.00 (raw units) · scale ×0.0254 (inches (SketchUp) → ×0.0254) · folder `food/market_displays`

> Skipped by the owner — will be removed from the folder.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|

Skipped: `Material145` (pack skipped), `Material2` (pack skipped), `Material2_1` (pack skipped), `Melon_01` (pack skipped), `Melon_02` (pack skipped), `Metal_Corrogated_Shiny` (pack skipped), `Metal_Brass_Ceiling_2` (pack skipped), `C-Fruit_01` (pack skipped), `Blackberry` (pack skipped), `Material2_16` (pack skipped), `Material2_17` (pack skipped), `Material2_18` (pack skipped), `Material2_19` (pack skipped), `Apple_texture_2` (pack skipped), `Metal_Embossed_2` (pack skipped), `Metal_Embossed_2_8` (pack skipped), `Onion` (pack skipped), `Material2_23` (pack skipped), `Nut-02` (pack skipped), `Metal_Brass_Ceiling_13` (pack skipped), `Metal_Corrogated_Shiny_1` (pack skipped), `Material2_27` (pack skipped), `Material2_28` (pack skipped), `Material2_29` (pack skipped), `Material2_3` (pack skipped), `Material2_30` (pack skipped), `Basket_003` (pack skipped), `Image1` (pack skipped), `Material2_33` (pack skipped), `Material2_34` (pack skipped), `Material2_35` (pack skipped), `Material2_36` (pack skipped), `Material2_37` (pack skipped), `cabbage-soup-diet-1` (pack skipped), `cabbage-soup-diet-1_15` (pack skipped), `Apple_texture_green1` (pack skipped), `Material2_40` (pack skipped), `Material2_41` (pack skipped), `Material2_42` (pack skipped), `Material2_43` (pack skipped), `Mango-4` (pack skipped), `Packaged_Nut` (pack skipped), `Metal_Brass_Ceiling_6` (pack skipped), `Metal_Brass_Ceiling_7` (pack skipped), `Metal_Brass_Ceiling_8` (pack skipped), `ttar_watermelon_01_v_launch` (pack skipped), `Material2_5` (pack skipped), `Material2_50` (pack skipped), `watermelon-2` (pack skipped), `Metal_Brass_Ceiling_14` (pack skipped), `Metal_Embossed_1` (pack skipped), `Metal_Aluminum_Anodized` (pack skipped), `Material2_55` (pack skipped), `Material2_56` (pack skipped), `img10231774317` (pack skipped), `-Vegetation_-_Potted_Plant__1_-_Leaves1` (pack skipped), `Material2_6` (pack skipped), `Material2_60` (pack skipped), `Material2_61` (pack skipped), `Material2_62` (pack skipped), `Material2_63` (pack skipped), `Material2_64` (pack skipped), `Material2_65` (pack skipped), `Material2_66` (pack skipped), `Material2_67` (pack skipped), `Material2_68` (pack skipped), `Basket_2` (pack skipped), `Material2_8` (pack skipped), `Material2_9` (pack skipped), `Material3` (pack skipped), `Apple_texture_2_1` (pack skipped), `Metal_Brass_Ceiling_1` (pack skipped), `Material3_11` (pack skipped), `Material3_12` (pack skipped), `Material3_13` (pack skipped), `Material3_14` (pack skipped), `Onion_9` (pack skipped), `Containers` (pack skipped), `C-cap` (pack skipped), `Material3_18` (pack skipped), `Material3_19` (pack skipped), `Material3_2` (pack skipped), `Material3_20` (pack skipped), `Material3_21` (pack skipped), `Material3_22` (pack skipped), `Material3_23` (pack skipped), `Material3_24` (pack skipped), `Material3_25` (pack skipped), `Material3_26` (pack skipped), `Material3_27` (pack skipped), `Metal_Brass_Ceiling_7_16` (pack skipped), `Groundcover_Brick_Crushed` (pack skipped), `Apple_texture_green1_3` (pack skipped), `0004_HotPink` (pack skipped), `0023_FireBrick` (pack skipped), `0032_Moccasin` (pack skipped), `0002_MediumVioletRed` (pack skipped), `Material3_34` (pack skipped), `Metal_Brass_Ceiling_13_252` (pack skipped), `Material3_36` (pack skipped), `Metal_Brass_Ceiling_14_249` (pack skipped), `Cantaloupe` (pack skipped), `Metal_Embossed_1_257` (pack skipped), `Material3_4` (pack skipped), `Metal_Aluminum_Anodized_258` (pack skipped), `Material3_41` (pack skipped), `img10231774317_259` (pack skipped), `Metal_Embossed_3` (pack skipped), `Basket_1` (pack skipped), `Material3_55` (pack skipped), `Material3_56` (pack skipped), `Material3_57` (pack skipped), `Material3_58` (pack skipped), `Basket_2_4` (pack skipped), `Material3_7` (pack skipped), `Material3_8` (pack skipped), `Material3_9` (pack skipped)

## hanging_branch_of_dried_bay_leaves_for_cooking

`hanging_branch_of_dried_bay_leaves_for_cooking.glb` · 4 meshes · 41,066 triangles · file extent 26.46 × 92.65 × 112.72 (raw units) · scale ×0.01 (centimetres) · folder `decor/hanging`

> One hanging bundle, 93 cm. Made of scattered leaf cards — the voxel version will be a loose cloud; check it reads.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `dried_bay_leaves_branch` | Dried Bay Leaves Branch | 93 cm | 4 | 41,066 | kitchen, decor, ingredient, farm, plant | 1 parts merged |

## hanging_plants_001

`hanging_plants_001.glb` · 6 meshes · 80,976 triangles · file extent 2867.99 × 1947.59 × 885.72 (raw units) · scale ×0.001 (millimetres) · folder `decor/plants`

> Three copies of the same trailing plant (stem + leaves). Each pair becomes one 1.85 m hanging plant; the file has no pot.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `hanging_plant_trailing` | Hanging Plant (trailing) | 1.95 m | 2 | 26,992 | farm, plant, decor | 2 parts merged |
| `hanging_plant_trailing_2` | Hanging Plant Trailing 2 | 1.92 m | 2 | 26,992 | farm, plant, decor | 2 parts merged |
| `hanging_plant_trailing_3` | Hanging Plant Trailing 3 | 1.84 m | 2 | 26,992 | farm, plant, decor | 2 parts merged |

## hanging_pothos

`hanging_pothos.glb` · 20 meshes · 48,136 triangles · file extent 18.76 × 20.57 × 39.86 (raw units) · scale ×0.01 (centimetres) · folder `decor/plants`

> The 'Constructed Sample' is the finished plant (pot, string, vines); the loose stems, leaves and samples are its building blocks and are skipped.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `hanging_pothos` | Hanging Pothos | 21 cm | 7 | 29,672 | kitchen | 3 parts merged · detail ultra |

Skipped: `Leaf 1` (building blocks), `Leaf 2` (building blocks), `Leaf 3` (building blocks), `Pot_Pot_0` (building blocks), `Sample 1` (building blocks of the constructed plant), `Sample 2` (building blocks), `Sample 3` (building blocks), `Stem 1` (building blocks), `Stem 2` (building blocks), `Stem 3` (building blocks)

## house_plants_hanging_pot

`house_plants_hanging_pot.glb` · 7 meshes · 404,852 triangles · file extent 9.28 × 22.12 × 9.09 (raw units) · scale ×0.01 (centimetres) · folder `decor/plants`

> One hanging pot plant (pot + foliage), 22 cm — small; 405k triangles.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `hanging_pot_plant` | Hanging Pot Plant | 22 cm | 7 | 404,852 | farm, cooking, plant, decor | 2 parts merged · detail ultra · ⚠️ 405k triangles — slow to convert |

## indoor_plants

`indoor_plants.glb` · 18 meshes · 188,802 triangles · file extent 2.26 × 1.11 × 0.91 (raw units) · scale ×1 (metres) · folder `decor/plants`

> Four potted house plants (peace lily, monstera, rubber plant, aloe in its pot). 189k triangles, realistic style.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `aloe_vera_potted` | Aloe Vera Potted | 44 cm | 3 | 83,063 | kitchen | 2 parts merged · detail ultra |
| `ficus_elastica` | Ficus Elastica | 1.11 m | 5 | 72,093 | kitchen |  |
| `monstera` | Monstera | 1.07 m | 5 | 16,626 | kitchen |  |
| `peace_lily` | Peace Lily | 91 cm | 5 | 17,020 | kitchen |  |

## kitchen_-_assets

`kitchen_-_assets.glb` · 48 meshes · 102,181 triangles · file extent 0.75 × 2.25 × 1.74 (raw units) · scale ×1 (metres) · folder `kitchen/kitchen_assets`

> Realistic kitchen kit whose objects come in parts. Parts are merged: sink (basin, legs, drain, faucet), portable stove (base, burners, grates, tumbler, wire), gas cylinders with taps, jars and cans with lids, stew pot with lid, cooking table (top, shelf, legs, bolts), pot rack (rack, rails, hooks).

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `sink_steel` | Sink Steel | 1.18 m | 5 | 6,601 | kitchen | 5 parts merged · → `kitchen/equipment` |
| `portable_stove` | Portable Stove | 12 cm | 6 | 11,256 | kitchen, cooking, appliance | 6 parts merged · → `kitchen/equipment` |
| `gas_cylinder` | Gas Cylinder | 47 cm | 2 | 2,369 | kitchen | 2 parts merged · → `kitchen/equipment` |
| `gas_cylinder_small` | Gas Cylinder Small | 15 cm | 2 | 2,369 | kitchen | 2 parts merged · → `kitchen/equipment` |
| `glass_jar_lidded` | Glass Jar Lidded | 14 cm | 2 | 1,278 | kitchen, dining, food, tableware, storage | 2 parts merged · → `food/pantry_assets` · detail ultra |
| `tin_can_lidded` | Tin Can Lidded | 17 cm | 2 | 1,512 | kitchen, food, storage | 2 parts merged · → `food/pantry_assets` · detail ultra |
| `stew_pot_lidded` | Stew Pot Lidded | 21 cm | 2 | 4,776 | kitchen, cooking | 2 parts merged · detail ultra |
| `cooking_table_steel` | Cooking Table Steel | 88 cm | 5 | 888 | kitchen, furniture | 5 parts merged · → `kitchen/equipment` |
| `pot_rack` | Pot Rack | 66 cm | 3 | 4,712 | kitchen, cooking, storage | 3 parts merged · → `kitchen/equipment` |
| `cooking_pot_steel` | Cooking Pot Steel | 37 cm | 1 | 966 | kitchen, cooking | detail ultra |
| `cast_iron_pan` | Cast Iron Pan | 46 cm | 1 | 1,178 | kitchen, cooking | detail ultra |
| `plate_plain` | Plate Plain | 3 cm | 1 | 1,220 | kitchen, dining, tableware | detail ultra |
| `canned_food_flat_1` | Canned Food Flat 1 | 2 cm | 1 | 1,524 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_tall_1` | Canned Food Tall 1 | 8 cm | 1 | 2,324 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `cardboard_food_box` | Cardboard Food Box | 20 cm | 1 | 44 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `food_bag` | Food Bag | 7 cm | 1 | 8,148 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `liquid_soap` | Liquid Soap | 23 cm | 1 | 1,714 | kitchen, storage | → `kitchen/cleaning` |
| `ketchup_bottle` | Ketchup Bottle | 8 cm | 1 | 716 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `cookies_package` | Cookies Package | 5 cm | 1 | 13,384 | kitchen, food | → `food/pantry_assets` · detail ultra |
| `flour_bag` | Flour Bag | 22 cm | 1 | 13,186 | kitchen, food, ingredient, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_flat_2` | Canned Food Flat 2 | 2 cm | 1 | 1,524 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_flat_3` | Canned Food Flat 3 | 2 cm | 1 | 1,524 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_flat_4` | Canned Food Flat 4 | 2 cm | 1 | 1,524 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_tall_2` | Canned Food Tall 2 | 8 cm | 1 | 2,324 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_tall_3` | Canned Food Tall 3 | 8 cm | 1 | 2,324 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_tall_4` | Canned Food Tall 4 | 8 cm | 1 | 2,324 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `canned_food_tall_5` | Canned Food Tall 5 | 8 cm | 1 | 2,324 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |
| `food_bag_2` | Food Bag 2 | 12 cm | 1 | 8,148 | kitchen, food, storage | → `food/pantry_assets` · detail ultra |

## kitchen_appliances

`kitchen_appliances.glb` · 25 meshes · 25,510 triangles · file extent 5.06 × 3.98 × 1.30 (raw units) · scale ×0.33 (oversized ×3 → scaled to 0.33) · folder `kitchen/utensils_cartoon`

> Chunky cartoon utensils (a 1.35 m rolling pin in the file). Scaled to real sizes: rolling pin 45 cm, ladle 42 cm, big pan 47 cm. The two 'Cube' meshes are knives; the grill and the baking form come in two halves and are merged.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `grill_barbecue_cartoon` | Grill Barbecue Cartoon | 33 cm | 2 | 2,504 | kitchen | 2 parts merged · detail ultra |
| `baking_form_cartoon` | Baking Form Cartoon | 30 cm | 2 | 2,254 | kitchen | 2 parts merged · detail ultra |
| `mug_cartoon` | Mug Cartoon | 14 cm | 1 | 1,312 | kitchen, dining, tableware | detail ultra |
| `mug_cartoon_2` | Mug Cartoon 2 | 13 cm | 1 | 804 | kitchen, dining, tableware | detail ultra |
| `frying_pan_big_cartoon` | Frying Pan Big Cartoon | 47 cm | 1 | 648 | kitchen, cooking | detail ultra |
| `cutting_board_cartoon` | Cutting Board Cartoon | 38 cm | 1 | 416 | kitchen, prep | detail ultra |
| `bowl_cartoon` | Bowl Cartoon | 13 cm | 1 | 540 | kitchen, dining, tableware | detail ultra |
| `bowl_cartoon_shallow` | Bowl Cartoon Shallow | 6 cm | 1 | 380 | kitchen, dining, tableware | detail ultra |
| `knife_cartoon` | Knife Cartoon | 35 cm | 1 | 576 | kitchen, prep, tool | detail ultra |
| `knife_cartoon_2` | Knife Cartoon 2 | 41 cm | 1 | 868 | kitchen, prep, tool | detail ultra |
| `carving_fork` | Carving Fork | 42 cm | 1 | 568 | kitchen, prep, tool | detail ultra |
| `fork_cartoon` | Fork Cartoon | 21 cm | 1 | 304 | kitchen, prep, tool | detail ultra |
| `grater_cartoon` | Grater Cartoon | 35 cm | 1 | 6,560 | kitchen, prep, tool | detail ultra |
| `ladle_cartoon` | Ladle Cartoon | 42 cm | 1 | 780 | kitchen, prep, tool | detail ultra |
| `mixing_spoon` | Mixing Spoon | 40 cm | 1 | 564 | kitchen, prep, tool | detail ultra |
| `saucepan_cartoon` | Saucepan Cartoon | 25 cm | 1 | 1,492 | kitchen | detail ultra |
| `saucepan_small_cartoon` | Saucepan Small Cartoon | 12 cm | 1 | 862 | kitchen | detail ultra |
| `pot_lid_cartoon` | Pot Lid Cartoon | 12 cm | 1 | 1,156 | kitchen, cooking | detail ultra |
| `rolling_pin` | Rolling Pin | 44 cm | 1 | 636 | kitchen | detail ultra |
| `frying_pan_small_cartoon` | Frying Pan Small Cartoon | 35 cm | 1 | 648 | kitchen, cooking | detail ultra |
| `spatula_flat_cartoon` | Spatula Flat Cartoon | 40 cm | 1 | 358 | kitchen, prep, tool | detail ultra |
| `spatula_cartoon` | Spatula Cartoon | 42 cm | 1 | 896 | kitchen, prep, tool | detail ultra |
| `spoon_cartoon` | Spoon Cartoon | 20 cm | 1 | 384 | kitchen, prep, tool | detail ultra |

## lamp_02_lowpoly

`lamp_02_lowpoly.glb` · 1 meshes · 1,896 triangles · file extent 0.67 × 1.25 × 0.67 (raw units) · scale ×1 (metres) · folder `dining/lighting`

> One hanging pendant lamp, 1.25 m including the cord.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `pendant_lamp_copper` | Copper Pendant Lamp | 1.25 m | 1 | 1,896 | dining, decor | 1 parts merged |

## low_poly_farm_v2

`low_poly_farm_v2.glb` · 22 meshes · 48,780 triangles · file extent 37.14 × 19.55 × 38.11 (raw units) · scale ×0.5 (toy scale ×2 → scaled to 0.5) · folder `farm/animals_and_buildings`

> Skipped by the owner — will be removed from the folder.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|

Skipped: `Cube.000_0` (pack skipped), `Cube.001_0` (pack skipped), `Cube.002_0` (pack skipped), `Cube.009_0` (pack skipped), `Cube.010_0` (pack skipped), `Cube.011_0` (pack skipped), `Cube.013_0` (pack skipped), `Cube.014_0` (pack skipped), `Cylinder.000_0` (pack skipped), `Cylinder.001_0` (pack skipped), `Plane.000_0` (pack skipped), `Plane.001_0` (pack skipped), `Plane.002_0` (pack skipped), `Plane.003_0` (pack skipped), `Plane.004_0` (pack skipped), `Plane.005_0` (pack skipped), `Plane.006_0` (pack skipped), `Plane.007_0` (pack skipped), `Plane.008_0` (pack skipped), `Plane_0` (pack skipped), `Sphere.001_0` (pack skipped), `Text.001_0` (pack skipped)

## modular_plant_shelf

`modular_plant_shelf.glb` · 11 meshes · 3,760 triangles · file extent 1.98 × 3.17 × 0.86 (raw units) · scale ×1 (metres) · folder `decor/plant_shelf`

> A modular wall plant shelf: shelf modules, connectors, wall holder, and four sample plants (spinach, rutabaga, carrot, flowers) that can be placed on it.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `carrot_potted` | Carrot Potted | 77 cm | 1 | 122 | farm, ingredient, storage, plant, decor |  |
| `plant_shelf_connector_first` | Plant Shelf Connector First | 97 cm | 1 | 368 | farm, storage, plant, decor |  |
| `plant_shelf_connector_2` | Plant Shelf Connector 2 | 87 cm | 1 | 368 | farm, storage, plant, decor |  |
| `plant_shelf_connector` | Plant Shelf Connector | 87 cm | 1 | 368 | farm, storage, plant, decor |  |
| `flowers_potted` | Flowers Potted | 68 cm | 1 | 1,070 | farm, storage, plant, decor |  |
| `rutabaga_potted` | Rutabaga Potted | 85 cm | 1 | 137 | farm, storage, plant, decor |  |
| `plant_shelf_first` | Plant Shelf First | 48 cm | 1 | 326 | farm, storage, plant, decor |  |
| `plant_shelf_module_2` | Plant Shelf Module 2 | 55 cm | 1 | 289 | farm, storage, plant, decor |  |
| `plant_shelf_module` | Plant Shelf Module | 55 cm | 1 | 289 | farm, storage, plant, decor |  |
| `spinach_potted` | Spinach Potted | 51 cm | 1 | 51 | farm, storage, plant, decor |  |
| `plant_shelf_wall_holder` | Plant Shelf Wall Holder | 68 cm | 1 | 372 | outdoor, storage, plant, fence, decor, structure |  |

## shelf

`shelf.glb` · 5 meshes · 13,837 triangles · file extent 0.43 × 1.01 × 1.61 (raw units) · scale ×1 (metres) · folder `kitchen/shelving`

> One three-tier shelf unit (metal frame + three wooden boards). 98 cm.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `wall_shelf_wood_metal` | Wall Shelf (wood & metal) | 98 cm | 5 | 13,837 | kitchen, outdoor, storage, fence, structure | 5 parts merged |

## stainless_steel_shelving_restaurant_equipment

`stainless_steel_shelving_restaurant_equipment.glb` · 3 meshes · 4,804 triangles · file extent 73.88 × 84.00 × 25.88 (raw units) · scale ×0.0254 (inches (SketchUp) → ×0.0254) · folder `kitchen/shelving`

> One five-tier restaurant shelving unit, 84 in = 2.13 m.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `steel_shelving_unit` | Stainless Steel Shelving | 2.13 m | 3 | 4,804 | kitchen | 3 parts merged |

## steel_table

`steel_table.glb` · 2 meshes · 10,652 triangles · file extent 2000.00 × 849.40 × 638.12 (raw units) · scale ×0.001 (millimetres) · folder `kitchen/equipment`

> One stainless prep table with undershelf, 2.0 m long, 85 cm high.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `steel_work_table` | Steel Work Table | 85 cm | 2 | 10,652 | kitchen, furniture | 1 parts merged |

## stylized_farm_objects_mobile_game_ready

`stylized_farm_objects_mobile_game_ready.glb` · 19 meshes · 1,902 triangles · file extent 10.52 × 3.44 × 4.16 (raw units) · scale ×1 (metres) · folder `farm`

> Already in the catalog (farm/tools, fences, crates, nature) — nothing to do.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|

Skipped: `Crate corner` (already imported (farm/*)), `Crate side long` (already imported), `Crate side short` (already imported), `Crate` (already imported), `Fence dense` (already imported), `Fence plank long` (already imported), `Fence plank` (already imported), `Fence post` (already imported), `Fence spaces` (already imported), `Fork` (already imported as pitchfork), `Grass_low_001` (already imported), `Grass_low_005` (already imported), `Grass_low_008` (already imported), `Grass_low_015` (already imported), `Hoe` (already imported), `Shovel` (already imported), `Stone flat` (already imported), `Stone` (already imported), `Watering can` (already imported)

## stylized_medieval_props

`stylized_medieval_props.glb` · 35 meshes · 23,468 triangles · file extent 10.37 × 1.58 × 5.04 (raw units) · scale ×1.3 (slightly small → ×1.3) · folder `outdoor/rustic_props`

> Rustic props that fit the farm-to-table look: tables, chair, barrels, crates, fences, hay, a well, a wagon, a ladder, climbing vines, flowers, foliage. Scaled so the table is 58 cm and the chair 77 cm.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `barrel_rustic` | Barrel Rustic | 70 cm | 1 | 1,008 | kitchen, storage |  |
| `barrel_and_crates` | Barrel And Crates | 1.21 m | 2 | 3,916 | kitchen, storage |  |
| `rustic_chair` | Rustic Chair | 77 cm | 1 | 540 | dining, seating, furniture | → `dining/seating` |
| `climbing_vine` | Climbing Vine | 11 cm | 1 | 336 | farm, plant, decor | → `decor/plants` |
| `climbing_vine_2` | Climbing Vine 2 | 13 cm | 1 | 384 | farm, plant, decor | → `decor/plants` |
| `climbing_vine_3` | Climbing Vine 3 | 12 cm | 1 | 752 | farm, plant, decor | → `decor/plants` |
| `crate_rustic` | Crate Rustic | 20 cm | 1 | 352 | kitchen, storage |  |
| `crate_rustic_open` | Crate Rustic Open | 50 cm | 2 | 1,548 | kitchen, storage |  |
| `fence_rustic` | Fence Rustic | 82 cm | 1 | 612 | outdoor, fence, structure |  |
| `fence_rustic_2` | Fence Rustic 2 | 82 cm | 1 | 594 | outdoor, fence, structure |  |
| `fence_rustic_3` | Fence Rustic 3 | 82 cm | 1 | 600 | outdoor, fence, structure |  |
| `flower_patch` | Flower Patch | 4 cm | 1 | 180 | farm, plant, decor | → `outdoor/nature` |
| `flower_patch_2` | Flower Patch 2 | 4 cm | 1 | 180 | farm, plant, decor | → `outdoor/nature` |
| `flower_patch_3` | Flower Patch 3 | 4 cm | 1 | 180 | farm, plant, decor | → `outdoor/nature` |
| `foliage_clump` | Foliage Clump | 14 cm | 1 | 64 | farm, plant, decor | → `outdoor/nature` |
| `foliage_clump_2` | Foliage Clump 2 | 13 cm | 1 | 64 | farm, plant, decor | → `outdoor/nature` |
| `foliage_clump_3` | Foliage Clump 3 | 14 cm | 1 | 64 | farm, plant, decor | → `outdoor/nature` |
| `grass_card` | Grass Card | 27 cm | 1 | 4 | farm, plant, decor | → `outdoor/nature` · detail chunky |
| `grassy_flower` | Grassy Flower | 27 cm | 1 | 544 | farm, plant, decor | → `outdoor/nature` |
| `grassy_flower_2` | Grassy Flower 2 | 27 cm | 1 | 544 | farm, plant, decor | → `outdoor/nature` |
| `grassy_flower_3` | Grassy Flower 3 | 27 cm | 1 | 544 | farm, plant, decor | → `outdoor/nature` |
| `hay_bale` | Hay Bale | 57 cm | 1 | 108 | outdoor, decor |  |
| `hay_bale_stack` | Hay Bale Stack | 1.09 m | 1 | 324 | outdoor, decor |  |
| `ladder_wood` | Ladder Wood | 1.51 m | 1 | 1,824 | kitchen |  |
| `metal_rod` | Metal Rod | 5 cm | 1 | 108 | kitchen |  |
| `stone_wall_section` | Stone Wall Section | 98 cm | 1 | 108 | outdoor, fence, decor, structure |  |
| `rustic_table` | Rustic Table | 58 cm | 1 | 552 | kitchen, furniture | → `dining/tables` |
| `rustic_table_2` | Rustic Table 2 | 59 cm | 1 | 912 | kitchen, furniture | → `dining/tables` |
| `wooden_wagon` | Wooden Wagon | 1.02 m | 1 | 1,982 | kitchen |  |
| `stone_well` | Stone Well | 2.04 m | 2 | 4,384 | outdoor, decor |  |
| `wooden_plank` | Wooden Plank | 7 cm | 1 | 12 | outdoor, fence, structure |  |
| `wooden_pole` | Wooden Pole | 5 cm | 1 | 144 | kitchen |  |

## trash_can_package_02

`trash_can_package_02.glb` · 17 meshes · 538,434 triangles · file extent 0.15 × 0.06 × 0.14 (raw units) · scale ×30 (tiny raw units (0.02–0.06) → ×30 so bins are 0.6–1.8 m) · folder `kitchen/waste`

> 17 scanned bins and containers (very high poly, 25–40k triangles each). Scaled to bin size; check the biggest two (TrashCan_19, TrashCan_13) which come out 1.3–1.8 m.

| id | name | h | parts | tri | tags | notes |
|---|---|---|---|---|---|---|
| `bin_11` | Bin 11 | 1.03 m | 1 | 26,318 | kitchen |  |
| `bin_08` | Bin 08 | 1.24 m | 1 | 26,384 | kitchen |  |
| `bin_09` | Bin 09 | 1.05 m | 1 | 27,598 | kitchen |  |
| `bin_10` | Bin 10 | 97 cm | 1 | 26,944 | kitchen |  |
| `bin_12` | Bin 12 | 54 cm | 1 | 34,902 | kitchen |  |
| `bin_13` | Bin 13 | 1.28 m | 1 | 34,166 | kitchen |  |
| `bin_14` | Bin 14 | 98 cm | 1 | 35,238 | kitchen |  |
| `bin_15` | Bin 15 | 79 cm | 1 | 35,684 | kitchen |  |
| `bin_16` | Bin 16 | 61 cm | 1 | 35,748 | kitchen |  |
| `bin_17` | Bin 17 | 1.19 m | 1 | 37,112 | kitchen |  |
| `bin_18` | Bin 18 | 62 cm | 1 | 32,946 | kitchen |  |
| `bin_19` | Bin 19 | 1.82 m | 1 | 39,958 | kitchen |  |
| `bin_20` | Bin 20 | 79 cm | 1 | 35,940 | kitchen |  |
| `bin_21` | Bin 21 | 72 cm | 1 | 24,346 | kitchen |  |
| `bin_22` | Bin 22 | 60 cm | 1 | 31,602 | kitchen |  |
| `bin_23` | Bin 23 | 60 cm | 1 | 24,738 | kitchen |  |
| `bin_24` | Bin 24 | 60 cm | 1 | 28,810 | kitchen |  |
