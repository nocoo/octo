import type { MemoryCreate } from "../apps/web/src/lib/schema/memory";

export type DemoSpace = { slug: string; name: string; description: string };
export type DemoMemory = {
	key: string;
	create: MemoryCreate;
	revision?: { body: string };
	trash?: boolean;
	attachment?: { name: string; type: string; body: string };
};

type Entry = {
	title: string;
	body: string;
	tags?: string[];
	revision?: string;
	attachment?: string;
};

export const demoSpaces: DemoSpace[] = [
	{
		slug: "demo-garden",
		name: "Garden Lab",
		description: "A small urban garden and its seasonal experiments.",
	},
	{
		slug: "demo-studio",
		name: "Field Notes Studio",
		description: "Creative practice, references, and project decisions.",
	},
	{
		slug: "demo-kitchen",
		name: "Kitchen Notebook",
		description: "Recipes, ingredients, and shared meals.",
	},
	{
		slug: "demo-trails",
		name: "Trail Journal",
		description: "Walking routes, observations, and trip planning.",
	},
	{
		slug: "demo-workshop",
		name: "Repair Workshop",
		description: "Practical repairs, tools, and small-build records.",
	},
	{
		slug: "demo-reading",
		name: "Reading Room",
		description: "Books, ideas, and questions worth revisiting.",
	},
];

const catalogue: Entry[][] = [
	[
		{
			title: "陽台番茄 Balcony tomato trial",
			body: "Two ‘Sungold’ seedlings went into 18 L pots on 12 May, one with a coir-heavy mix and one with compost-rich mix. The compost pot set fruit nine days earlier, but dried faster in afternoon sun; weigh pots before watering next round.",
			tags: ["tomato", "trial"],
		},
		{
			title: "高溫前澆水 Watering before the heat",
			body: "When the forecast exceeds 30°C, water the 18 L containers slowly at 7:00, until the first drip reaches the saucer. A 5 cm mulch layer kept the basil moist for an extra day; avoid wetting leaves before a hot afternoon. 中文提醒：摸土壤再決定澆水，不按固定日程。 🌱🌿🍅🥬🪴",
			tags: [
				"summer",
				"routine",
				"water",
				"balcony",
				"measurement",
				"plants",
				"heat",
				"morning",
				"trial",
				"care",
			],
		},
		{
			title: "種子信封盤點 Seed envelope inventory",
			body: "The drawer holds 14 envelopes: 2024 lettuce, calendula, radish, and three tomato varieties are still viable-looking; the unlabeled brown packet is not. Store the dry packets in a sealed tin, and write variety plus packed year on every replacement label.",
		},
		{
			title: "Compost smell checklist",
			body: "A sour smell after rain usually means the bucket is too wet, not that it needs fragrance or more greens. Mix one part dry leaves with two parts kitchen scraps, leave the lid ajar for ten minutes, and turn the top layer with the small fork.",
			revision:
				"The sour smell was blamed on citrus peel; later checks found the bucket compacted and waterlogged.",
		},
		{
			title: "羅勒初收 First basil harvest",
			body: "Pinch stems just above the second pair of leaves once the plant has six full sets; this produced 28 g of leaves without slowing new side shoots. Leave at least two nodes on every stem, then use the soft tips in noodles the same day.",
			attachment: "basil-pruning",
		},
		{
			title: "Aphids on the nasturtiums",
			body: "The colony clusters under new leaves near the east railing, while marigolds beside the pot stayed clear. Rinse the undersides with a low-pressure spray at dusk and inspect again after 48 hours; skip soap because ladybird larvae are already present.",
		},
		{
			title: "Rain barrel placement",
			body: "A 60 L barrel fits beneath the downpipe only if its base stays 8 cm clear of the drain cover. The balcony slab slopes toward the door, so put the stand against the outer wall and test a full 10 L before connecting the overflow hose.",
			revision:
				"Planned to put the barrel beside the door; the slab slope would have directed overflow toward the threshold.",
		},
		{
			title: "Shade cloth decision",
			body: "The west-facing peppers lost two leaves during a 34°C week, but morning growth remained sturdy. Use 30% shade cloth from 13:00 to 17:00 rather than permanent shade; clip it loosely so wind can lift an edge instead of pulling the railing.",
		},
		{
			title: "Garden log: late spring",
			body: "On 26 May, radishes were ready 31 days after sowing and the first tomato flowers opened on the lower truss. Overnight lows stayed above 12°C; the next sowing can move outside, but keep fleece ready for the forecast cold snap.",
		},
		{
			title: "Mint belongs in a pot",
			body: "Spearmint runners crossed the shared bed in three weeks and appeared beneath the chives. Move the root ball into a 25 cm pot with drainage holes, trim runners at the soil line, and keep the pot on a saucer that can be emptied after rain.",
		},
		{
			title: "Pollinator corner plan",
			body: "Reserve the 40 × 60 cm corner for calendula, borage, and a shallow water dish with pebbles. Stagger two sowings by three weeks so blooms overlap from June into September; leave the seed heads standing through the first cold nights.",
		},
		{
			title: "The bent trowel handle",
			body: "The blade is straight but the ash handle has a 4 mm split beside the ferrule. Dry it indoors for a day, wick thin wood glue into the crack, then clamp overnight; retire it if the split opens under a gentle hand load.",
		},
		{
			title: "Cherry tomato tasting",
			body: "The orange fruit tasted sweeter after two dry days, while the pink variety stayed tart even fully red. Sample three fruits from each plant at similar ripeness and note skin firmness too; yesterday’s single-fruit comparison was too small to guide next year’s choice.",
		},
		{
			title: "Autumn bed rotation",
			body: "Move brassicas away from last season’s kale strip and follow the peas with leafy greens to use the residual nitrogen. Add 2 cm of finished compost, but do not dig deeply around the shallow mint roots at the bed edge.",
			attachment: "bed-rotation",
		},
		{
			title: "Community seed swap",
			body: "Bring labeled seed portions in paper packets, with variety, harvest year, and growing notes written outside. The table opens at 10:30; take only what fits in the shared tray and leave a few envelopes for late arrivals.",
			revision:
				"The first plan was a bulk exchange; switched to small labeled portions so visitors can try more varieties.",
			attachment: "seed-swap",
		},
	],
	[
		{
			title: "安靜時段速寫 Quiet-hour sketch routine",
			body: "A 20-minute timer and one A5 sheet made the morning sketch habit easier to keep than an open-ended session. Start with five minutes of silhouette studies, then spend the remaining time on one object; stop when the timer rings, even mid-shading.",
			revision:
				"Used to aim for a finished drawing each morning, which made missed days feel like failure.",
		},
		{
			title: "海報網格尺寸 Poster grid measurements",
			body: "The wall poster is 420 × 594 mm with a 24 mm outer margin and a 12-column grid. Keep the headline across columns 2–10; a 6 mm gutter lets the two-color illustration align without a hairline gap after trimming.",
		},
		{
			title: "孔版印刷配色 Risograph color pairing",
			body: "Fluorescent orange over medium blue creates a dark overlap that swallows small captions below 11 pt. Keep the caption in blue only, reserve the orange for the large shape, and request a registration test before the 80-copy run.",
		},
		{
			title: "客戶審稿決定 Client review decision",
			body: "The reviewer chose the quieter version with one illustration and a single call to action, not the three-panel layout. Keep the bolder draft in the archive rather than merging its extra labels into the approved version.",
			revision:
				"The initial presentation recommended three panels; feedback favored a single focal point and less instructional copy.",
		},
		{
			title: "Reference: folded paper maps",
			body: "A pocket map remains readable because the fold sequence protects the legend and leaves the current region on the cover. Photograph the fold pattern flat, then annotate which panels disappear first when the sheet is opened one-handed.",
		},
		{
			title: "Studio opening checklist",
			body: "Unlock the north door at 9:15, turn on the extraction fan, and check that the sink trap is dry before setting out inks. The public worktable stays clear until the first workshop begins at 10:00; put wet proofs on the labeled rack.",
		},
		{
			title: "Typeface notes for labels",
			body: "At 8 pt the narrow sans loses its lowercase ‘e’ in the recycled stock’s rough fibers. Use the regular weight at 9.5 pt, set line spacing to 12 pt, and avoid all-caps product names longer than 14 characters.",
		},
		{
			title: "A rough idea about repair",
			body: "A small exhibition could pair a broken object with the sound of its repair, rather than showing only a polished before-and-after. Ask contributors for one sentence about why they kept the item, and make participation optional for personal histories.",
		},
		{
			title: "Project log: blue room",
			body: "The north wall reads greener than the sample card once the late-afternoon light disappears. Painted a 30 cm square beside the window and another near the door; compare both at 9:00 and 16:00 before ordering the final 4 L tin.",
		},
		{
			title: "How to export print files",
			body: "Package the PDF with fonts outlined only in the final copy, preserve the editable source separately, and export at 300 dpi with 3 mm bleed. Check the overprint preview for black text and inspect one crop mark at 200% before upload.\n\n```text\nformat: PDF/X-4\nbleed: 3 mm\nresolution: 300 dpi\n```",
		},
		{
			title: "A useful critique question",
			body: "Ask “what did you notice first?” before asking whether the design is liked; answers reveal hierarchy without steering people toward a preferred feature. Record exact phrases, and do not turn one participant’s taste into a universal rule.",
		},
		{
			title: "Paper stock comparison",
			body: "The 120 gsm uncoated sheet accepts pencil well but feathers the dark green ink, while the 100 gsm smooth stock holds fine lines. Print the same 50 × 50 mm swatch on both before choosing; the test costs two sheets and prevents a full-run surprise.",
		},
		{
			title: "Window-light photo setup",
			body: "Place the object 70 cm from the north window and use white card opposite it to lift the shadow. Turn off the ceiling lamp to avoid mixed color temperature, lock focus on the near edge, and include a ruler only in the documentation frame.",
		},
		{
			title: "Tiny exhibition plan",
			body: "Six prints fit the 2.4 m rail with 18 cm gaps and a 145 cm centerline. Hang the sequence from the doorway inward, leave the wheelchair turning space clear, and put the large-print labels at the entry and final work.",
			attachment: "gallery-layout",
		},
		{
			title: "Shared studio cleanup",
			body: "At closing, cap each ink jar, wipe the brayer with the approved cleaner, and return drying screens to the rack with mesh facing inward. The last person checks the extraction fan timer and posts a note if any solvent container is below its fill mark.",
		},
	],
	[
		{
			title: "平日晚餐扁豆湯 Weeknight lentil soup",
			body: "Rinse 180 g brown lentils and simmer with 900 ml stock, one diced carrot, and a bay leaf for about 28 minutes. Add lemon only after the lentils soften; the acid delayed yesterday’s batch by nearly ten minutes.",
			revision:
				"The first batch simmered the lemon with the lentils and stayed firm; adding it after softening fixed the texture.",
		},
		{
			title: "剛好的米水比例 Rice ratio that works",
			body: "For the small saucepan, 200 g jasmine rice needs 270 ml water after a quick rinse and two-minute drain. Bring it to a boil uncovered, cover on the lowest flame for 12 minutes, then rest off heat for 8 without lifting the lid.",
		},
		{
			title: "柑橘皮糖漿 Citrus peel syrup",
			body: "Simmer peel from two washed oranges with 250 g sugar and 250 ml water for 18 minutes, keeping the white pith thin to avoid bitterness. Chill the strained syrup in a clean jar and use within two weeks; the candied peel goes into breakfast oats.",
		},
		{
			title: "The no-waste lunch rule",
			body: "Build lunch from one cooked grain, one crisp vegetable, and a spoon of something acidic so leftovers feel intentional. Yesterday’s barley, cucumber ends, and yogurt-herb sauce filled two containers; keep wet dressing separate until eating.",
		},
		{
			title: "週日包餃子 Sunday dumpling session",
			body: "The 500 g flour dough yielded 42 wrappers at roughly 9 g each, enough for four people plus a freezer tray. Keep unused rounds under a damp towel, and label the mushroom filling separately because it contains sesame oil.",
			attachment: "dumpling-count",
		},
		{
			title: "Roasted squash timing",
			body: "Cut the squash into 3 cm wedges, coat with 15 ml oil, and roast at 220°C for 28–32 minutes on a preheated tray. Turn once at 18 minutes; crowding the pan traps steam and leaves the cut faces pale.",
		},
		{
			title: "Pantry inventory",
			body: "There are two unopened cans of chickpeas, 400 g rolled oats, half a jar of tahini, and no baking powder. Use the older rice first and write the opened date on the tahini lid; avoid buying another jar until this one is finished.",
		},
		{
			title: "A note on bitter greens",
			body: "Mustard greens mellow after a 90-second blanch, while young dandelion leaves are better sliced thin into a lemony salad. Taste the stem before seasoning: the bunch from the market varied enough that a fixed salt measure would overshoot.",
		},
		{
			title: "Dinner log: rainy Tuesday",
			body: "Made 24 cm skillet noodles with 300 g wheat noodles, cabbage, and the last 120 g of tofu; dinner took 22 minutes including chopping. The sauce was too sweet at two tablespoons of honey, so try one next time and add rice vinegar at the end.",
		},
		{
			title: "Freezer label format",
			body: "Write dish, portion count, and packed date on the short edge of each container so the label stays visible when stacked. Cool food in shallow trays first; the lentil stew went into three 350 ml portions and reheated evenly.\n\nLabel checklist:\n1. Dish name\n2. Portions and date\n3. Reheat temperature",
		},
		{
			title: "Adjusting the chili oil",
			body: "The new batch burned at the back of the throat because the flakes hit oil above 190°C. Let the oil fall to about 150°C, pour slowly over the spices, and add sesame only after the bubbling stops to protect its aroma.",
		},
		{
			title: "Market peaches at peak",
			body: "Choose fruit that yields slightly near the stem and smells floral, not merely soft all over. Four ripe peaches are for tonight’s tart; keep the firmer pair in a paper bag and check them tomorrow rather than refrigerating them now.",
		},
		{
			title: "Sourdough starter schedule",
			body: "Feed 30 g starter with 60 g water and 60 g flour at 8:00; at a 21°C room temperature it peaks in about seven hours. Mark the jar level with a rubber band, and refrigerate after the rise if baking moves to the following morning.",
		},
		{
			title: "Picnic menu for six",
			body: "Pack 12 small sandwiches, a 900 g potato salad in a sealed cooler, six apples, and two liters of water. Keep the dressing in a separate jar, bring serving tongs, and leave the nut-containing cookies in their own labeled tin.",
			attachment: "picnic-plan",
		},
		{
			title: "Borrowed pie dish",
			body: "The ceramic dish belongs to the shared kitchen shelf, not the oven’s broiler; its base is 24 cm across and needs a baking sheet underneath. Return it washed and fully dry by Thursday, and mention the hairline glaze mark so nobody mistakes it for new damage.",
		},
	],
	[
		{
			title: "黎明河岸環線 Riverside loop at dawn",
			body: "The 4.8 km loop took 68 minutes at an easy pace, with muddy ground for the last 600 m below the footbridge. Start before 7:00 to avoid the cycle commute, and take the higher path if the river gauge passes its yellow mark.",
		},
		{
			title: "出發前備水 Pack water before leaving",
			body: "For a two-hour walk in mild weather, carry at least 750 ml per person and add another 500 ml if the route has no refill point. The soft flask leaked when its cap was cross-threaded; squeeze-test it over the sink before packing.",
		},
		{
			title: "步道標記顏色 Trail marker color key",
			body: "Blue arrows mark the river route, white circles indicate the ridge connector, and red paint is reserved for temporary closure notices. At the split oak, follow blue downhill; a faded white mark on the back of the post points the opposite way.",
		},
		{
			title: "Wet-weather route choice",
			body: "After more than 20 mm of rain, avoid the clay descent at kilometre 3 and use the gravel service road instead. It adds 1.2 km but keeps the steepest section below 8%; check the lower bridge status before leaving.",
		},
		{
			title: "Birdsong near the footbridge",
			body: "Three repeated rising notes came from the willow bank at 6:40, followed by a shorter call from across the water. Record time, habitat, and sound pattern rather than guessing a species from one brief listen; keep playback off near nests.",
		},
		{
			title: "A respectful wildlife distance",
			body: "Stay at least 30 m from the nesting sign and use the marked bypass, even if the birds are not visible. Binoculars are useful from the public path; do not cross the rope for a closer photograph or leave food as a lure.",
		},
		{
			title: "Old rail path surface",
			body: "The northern mile has compact gravel with two shallow puddles, while the southern cut is loose ballast that catches narrow wheels. The accessible turn-around is 400 m beyond the old signal post; report newly exposed metal through the park office.",
			revision:
				"The route note originally called the whole path wheelchair-friendly; the ballast section requires a clear limitation.",
		},
		{
			title: "What went into the day pack",
			body: "The 18 L pack held a 750 ml bottle, paper map, light shell, snack, and a small first-aid pouch, totaling 3.4 kg. Remove the spare mug next time; it stayed unused and shifted against the camera on every descent.",
		},
		{
			title: "Walk log: cedar ridge",
			body: "Started at 9:12 under cloud, reached the ridge bench after 54 minutes, and turned back at 12:05 when wind picked up. The western viewpoint had fallen branches across its approach; the main trail remained open and well marked.",
		},
		{
			title: "Map scale conversion",
			body: "On the printed 1:25,000 map, 4 cm equals 1 km and the contour interval is 10 m. The planned traverse measured 7.6 cm straight-line, so allow extra distance for switchbacks and check the elevation profile before estimating time.",
		},
		{
			title: "Rest stop with a view",
			body: "The stone bench above the inlet has shade after 11:30 and a clear line of sight to the marked ferry channel. Sit on the inland side during gusts; the seaward edge is narrow and the viewpoint has no guardrail.",
		},
		{
			title: "Repairing a loose lace hook",
			body: "The upper hook rotated because its two tiny rivets loosened, not because the lace was too thick. Dry the boot fully, squeeze the rivet gently with padded pliers, and replace the hook at a repair shop if the metal cracks.",
		},
		{
			title: "Wildflower observation",
			body: "A patch of purple flowers grew in sandy soil beside the east trail, with bees visiting each open head in warm sun. Photograph the whole plant and leaf arrangement without picking it; use the park’s local guide later rather than relying on color alone.",
		},
		{
			title: "Two-day coast itinerary",
			body: "Day one covers the 6 km headland path and ends at the bus stop before the last 17:40 service; day two stays on the sheltered harbor walk. Check tide times, carry 1.5 L water per person, and reserve a weather fallback before setting out.",
		},
		{
			title: "Bus back from the trailhead",
			body: "The stop across from the old depot has hourly service at :20, but the Sunday timetable skips 16:20. Keep the route number saved offline, signal from the paved pull-in, and have a second pickup point in case the coastal road closes.",
		},
	],
	[
		{
			title: "檯燈開關診斷 Lamp switch diagnosis",
			body: "Unplug the lamp before opening the base; the switch clicks normally but continuity drops when the cord bends near its entry. Inspect the strain relief first, and replace the cord assembly rather than taping over damaged insulation.",
			revision:
				"Initially suspected the bulb socket; testing the cord while unplugged located the intermittent fault at the entry.",
		},
		{
			title: "依螺紋分類螺絲 Sort screws by thread",
			body: "Keep M3 machine screws apart from wood screws even when their heads look similar; a 10 mm M3 screw should turn freely in the matching nut by hand. Use labeled trays for diameter and length, and stop at the first sign of cross-threading.",
			revision:
				"Previously grouped screws by head shape; sorting by thread and length prevents mismatched fasteners reaching the bench.",
		},
		{
			title: "木工膠夾持時間 Wood glue clamp time",
			body: "The oak offcut joint held alignment with two clamps and a thin, continuous bead of PVA; squeeze-out appeared along the full edge. Leave it clamped for 45 minutes and avoid loading it for 24 hours, especially in the cool unheated room.",
		},
		{
			title: "Decision: patch the stool",
			body: "The legs remain square and the loose seat rail has no rot, so a glue-and-screw repair is safer than replacing the stool. Add a 6 mm hardwood dowel only if the old screw hole will not hold; preserve the worn finish rather than sanding the whole piece.",
			revision:
				"Considered replacing the stool after the first wobble; inspection showed one sound rail joint had simply opened.",
		},
		{
			title: "Tool checkout routine",
			body: "Write the tool name and return time on the board before carrying it beyond the bench. Check guards and cords together at handoff; a missing wrench stays attached to the tool card until the kit is complete.",
			attachment: "tool-checkout",
		},
		{
			title: "Small shelf cut list",
			body: "The shelf needs two 420 × 90 mm sides, one 600 × 120 mm top, and a 560 × 80 mm back rail from a 12 mm board. Cut the long pieces first, mark the finished face, and dry-fit the corners before applying glue.",
		},
		{
			title: "Cleaning a rusty plane",
			body: "The plane sole has surface rust but no deep pitting, so use a small amount of oil and a fine abrasive pad with the blade removed. Wipe until the cloth stays clean, dry the body completely, and add a thin protective coat before storage.",
		},
		{
			title: "Why the hinge squeaks",
			body: "The cabinet hinge binds only in the final centimeter, where the mounting plate sits slightly proud of the door edge. Tighten the upper screw by a quarter turn, test ten slow openings, and avoid spraying lubricant onto the painted panel.",
		},
		{
			title: "Workshop log: radio case",
			body: "The rear panel split along the old screw line but the molded front survived. A 1 mm PET sheet cut to 62 × 104 mm protects the board; drill pilot holes at low speed and keep the antenna clearance open.",
		},
		{
			title: "Safe battery storage",
			body: "Keep loose cells in their original tray, away from metal offcuts and direct sun; never store swollen or leaking batteries in the general drawer. The labeled return box is for intact rechargeables only, and damaged cells go to the designated collection point.",
		},
		{
			title: "Cable sleeve measurements",
			body: "The lamp cord measures 6.2 mm across, so the 8 mm braided sleeve slides over the plug without cutting the connector. Cut 40 cm plus 2 cm allowance, seal the ends away from flame, and keep the switch accessible.",
		},
		{
			title: "A better bench layout",
			body: "Move the frequently used square and marking knife to the left rail, leaving a 45 cm clear zone for assembly. The vise handle currently collides with the drawer; shift the drawer stop before relocating the vise itself.",
		},
		{
			title: "Testing the repaired lamp",
			body: "After reassembly, inspect the cord grip and case screws before plugging into the protected test outlet. Run the lamp for 15 minutes while checking for heat or flicker; stop immediately if the switch housing warms or the cord shifts.",
			attachment: "lamp-test",
		},
		{
			title: "Cardboard jig for drilling",
			body: "A folded 3 mm card jig kept the shelf pin holes 32 mm from the front edge and 50 mm apart. Mark the drill center through the guide, clamp scrap behind the board to prevent breakout, and verify the first hole before repeating the row.",
		},
		{
			title: "Neighborhood fix-it table",
			body: "Set out a sign-up sheet, two repair mats, and a clear boundary between diagnostic advice and electrical work. The Saturday session runs 13:00–16:00; accept small household items only and direct mains wiring issues to a licensed professional.",
		},
	],
	[
		{
			title: "城市與記憶 The city and its memory",
			body: "The essay’s demolished market hall is described through shopkeepers’ repeated routes rather than a single architectural history. Mark the paragraphs where ordinary routines carry the argument, then compare them with the chapter’s official planning documents.\n\nRelated reading: [municipal archive guide](https://example.invalid/archive-guide).",
		},
		{
			title: "關於專注的一句話 A sentence about attention",
			body: "The line ‘attention is a form of hospitality’ appears on page 42 in the paperback edition, immediately after a description of waiting in a station. It changes the chapter from productivity advice into an account of making room for another person.",
		},
		{
			title: "閱讀筆記：第二章 Reading notes",
			body: "Chapter two contrasts the narrator’s confident dates with a letter that places the same event in autumn, so chronology may be deliberately unstable. Note each conflicting account before deciding whether the discrepancy is memory, editing, or plot evidence.",
		},
		{
			title: "保留開放問題 Keep the question open",
			body: "For discussion, ask whether the empty house functions as refuge or as evidence of exclusion; the text supports both readings. Collect a passage for each interpretation before voting, and let disagreement remain visible in the notes.",
			revision:
				"The earlier prompt asked for the ‘correct’ symbolism; changing it to two evidence-based readings invites a more useful discussion.",
		},
		{
			title: "Library hold list",
			body: "The printmaking handbook is due back on the 18th and can be renewed once; the essay collection is ready for pickup at the west branch. Bring the reusable sleeve because the walk from the stop is often wet.",
		},
		{
			title: "Quote about ordinary tools",
			body: "> “A tool remembers the pressure of the hand, even after the work is done.”\n\nThis is a paraphrased reading note, not a verified quotation. Check the marked passage in the library copy before using exact wording in a public handout.",
		},
		{
			title: "Two translations compared",
			body: "Version A keeps the repeated verb ‘to carry’ across three lines, while Version B varies it as ‘bear’ and ‘bring’. Read both aloud beside the original; the rhythm changes more than the literal meaning in this paragraph.",
		},
		{
			title: "A book-club format that works",
			body: "Send one passage and one open question three days ahead, then spend the first ten minutes hearing from people who have not spoken yet. Keep the group to six readers and end with a round of unresolved questions, not a forced verdict.",
		},
		{
			title: "Reading log: winter pages",
			body: "Finished 46 pages on the train over four rides, mostly in short scenes that end before the explanation arrives. The recurring blue-window image appeared three times; flag those pages and see whether its meaning changes by the final section.",
		},
		{
			title: "How to cite an edition",
			body: "Record author, translator, edition statement, publisher, year, and the page number from the copy actually consulted. The library’s reprint resets pagination, so do not reuse page references from the older review online.",
		},
		{
			title: "The unreliable narrator",
			body: "The narrator reports the same dinner as silent in one chapter and argumentative in a later recollection. Track who was present and what each account can know; unreliability is a clue to perspective, not proof that every detail is false.",
		},
		{
			title: "Margin note on scale",
			body: "A paragraph moves from one chipped cup to a neighborhood’s changing rent in four sentences, without claiming the cup represents everyone. The jump in scale is persuasive because the narrator names a specific street and a date.",
		},
		{
			title: "Borrowed essay collection",
			body: "The blue-covered collection belongs to the reading-room shelf and is due back next Tuesday. A pressed receipt sits at page 73; leave it in place, photograph the title page for citation, and return the book without adding marks.",
		},
		{
			title:
				"Reading order for a trilogy: a long-form guide to publication chronology, recurring images, shifting narrators, and the careful comparison of three interconnected novellas",
			body: "Read the novellas in publication order because the final volume revisits an image introduced in the first, despite its earlier historical setting. Keep a one-line character list nearby; names recur with different roles across generations.",
		},
		{
			title: "下月讀書會 Next month's discussion",
			body: "The next meeting centers on how translation changes a place name and whose account becomes the neighborhood’s official memory. Read chapters 3–5, bring one short passage in either language, and compare what disappears when a local term is replaced by a broad English equivalent.",
		},
	],
];

const types = ["fact", "preference", "decision", "procedure", "event", "log", "note"] as const;
const spaceTags = [
	["gardening", "都市园艺"],
	["design", "创作"],
	["cooking", "食谱"],
	["outdoors", "路线"],
	["repair", "维修"],
	["reading", "读书笔记"],
] as const;
const sharedTags = [
	["reference", "待验证"],
	["checklist", "shared"],
	["observation", "follow-up"],
	["planning", "周末计划"],
	["how-to", "收藏"],
] as const;
const eventDates = [
	"2019-06-15T12:00:00.000Z",
	"2024-03-15T12:00:00.000Z",
	"2026-10-21T12:00:00.000Z",
	"2028-05-15T12:00:00.000Z",
] as const;
const attachments = new Map([
	[
		"basil-pruning",
		'<path d="M120 100C55 88 60 42 120 30c60 12 65 58 0 70Z" fill="#76a86b"/><path d="M120 100V35" stroke="#315a3d" stroke-width="4"/>',
	],
	[
		"bed-rotation",
		'<rect x="35" y="28" width="70" height="65" fill="#88a96a"/><rect x="135" y="28" width="70" height="65" fill="#d9a25d"/><path d="M105 60h30m-8-8 8 8-8 8" stroke="#354d3c" stroke-width="4"/>',
	],
	[
		"gallery-layout",
		'<path d="M25 75h190" stroke="#555" stroke-width="4"/><rect x="42" y="35" width="42" height="32" fill="#628c9a"/><rect x="99" y="35" width="42" height="32" fill="#d58a56"/><rect x="156" y="35" width="42" height="32" fill="#82996a"/>',
	],
	[
		"dumpling-count",
		'<path d="M35 78q25-42 50 0-25 20-50 0Zm65 0q25-42 50 0-25 20-50 0Zm65 0q25-42 50 0-25 20-50 0Z" fill="#e9c57a" stroke="#805e37" stroke-width="3"/>',
	],
	[
		"picnic-plan",
		'<path d="M50 38h140v58H50z" fill="#e5b86d"/><path d="M50 58h140M95 38v58m48-58v58" stroke="#fff4d5" stroke-width="5"/><circle cx="70" cy="48" r="5" fill="#668957"/>',
	],
	[
		"tool-checkout",
		'<rect x="65" y="24" width="110" height="76" rx="8" fill="#d9e3d5" stroke="#54715a" stroke-width="3"/><path d="M84 48h70m-70 20h55m-55 20h38" stroke="#54715a" stroke-width="4"/>',
	],
	[
		"lamp-test",
		'<path d="M120 25 85 70h70l-35-45Zm0 45v27m-24 8h48" fill="#edc66e" stroke="#705a35" stroke-width="4"/><circle cx="120" cy="55" r="9" fill="#fff4bd"/>',
	],
]);

function at<T>(items: readonly T[], index: number, label: string): T {
	const item = items[index];
	if (item === undefined) throw new Error(`Missing ${label} at index ${index}`);
	return item;
}

export const demoMemories: DemoMemory[] = demoSpaces.flatMap((space, spaceIndex) =>
	at(catalogue, spaceIndex, "space catalogue").map((entry, index) => {
		const key = `${space.slug}-${entry.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")}`;
		const type = at(types, (spaceIndex * 3 + index) % types.length, "memory type");
		const body = spaceIndex === 0 && index === 0 ? "" : entry.body;
		const longGuide =
			spaceIndex === 0 && index === 13
				? `# Autumn bed rotation field guide\n\n## Map the bed\nMeasure the two beds before moving compost. Keep brassicas out of the kale strip used last season, and mark the pea row that can follow with leafy greens. The narrow edge beside the mint is a no-dig zone because its shallow runners spread beneath the timber.\n\n| Bed | Previous crop | Next crop | Reason |\n| --- | --- | --- | --- |\n| North | kale | lettuce and spinach | avoid repeated brassicas |\n| South | peas | brassicas | use the remaining space |\n\n## Prepare the soil\nRemove spent roots by hand and leave healthy fine roots in place. Spread 2 cm of finished compost over the open soil; do not bury the bed or dig deeply around the mint. Water lightly if the surface is dry, then let the bed settle overnight before transplanting.\n\n## Planting sequence\nSet lettuce 20 cm apart in staggered rows and spinach 10 cm apart. Keep brassica collars above soil level, label each variety with its sowing date, and water each transplant with roughly 250 ml. A cloudy afternoon is preferable; if planting in sun, shade seedlings for the first two days.\n\n## Follow-up checks\nInspect for slugs at dusk during the first week and replace any seedling that has lost its growing point. Record rainfall rather than watering by calendar: add water only when the top 3 cm is dry. After four weeks, note leaf color and growth so next autumn’s rotation is based on evidence rather than memory.\n\n## Materials and constraints\nUse the existing hand fork, 8 L of mature compost, six labels, and a watering can. Do not use fresh manure, synthetic pesticide, or new plastic edging; the shared bed must remain accessible from the path and the mint boundary stays intact.`
				: body;
		const create: MemoryCreate = {
			space: space.slug,
			title: entry.title,
			body:
				spaceIndex === 0 && index === 13
					? `${longGuide}\n\n${[
							"## Bed-by-bed working notes\nBegin at the north bed because its lettuce seedlings are hardened off. Set the tray on the path in shade, water each cell until the compost is damp, and plant the largest six seedlings first. If roots circle tightly around a cell, tease only the outermost layer loose; never pull the stem to free the plug. Keep remaining seedlings in reserve for gaps discovered after watering.",
							"The south bed follows the pea harvest. Cut pea stems at soil level rather than pulling them, since the roots help hold the soil structure and healthy tops can go into compost. Clear the support net carefully, fold it dry, and store it in the labeled crate. Check for missed pods before raking; they can sprout unexpectedly among later brassicas.",
							"## Spacing and access\nStretch a string along the 1.2 m bed width and mark the first row 15 cm from the timber edge. Stagger the second row by half a plant spacing so leaves overlap less and water reaches the soil. Leave a 30 cm working strip beside the path for knees and the watering can. Never stand inside the bed to reach the far row; use the long-handled fork to avoid compressing damp soil.",
							"Plant labels face the path and use pencil rather than marker because rain fades ink. Write crop, variety, sowing date, and source in that order. Put a duplicate label at the far end of each row, where it remains readable if the first label is covered by foliage. Photograph the finished layout from above only after checking that neighboring plots are not shown.",
							"## Compost and soil texture\nThe 8 L compost allowance is enough for a thin top dressing, not a deep amendment. Break clumps by hand and remove plastic or woody stems larger than a thumb. If compost smells earthy and holds together when squeezed but crumbles when touched, it is ready. Sour or ammonia odor means it should stay in the curing bin instead of going around young roots.",
							"Do not mix compost into wet clay. Take a handful from 5 cm below the surface; if it forms a glossy ribbon when squeezed, postpone planting until it dries. On workable soil, loosen only the top 5 cm between rows and keep the fork outside the marked mint boundary. This shallow approach protects worms and avoids bringing buried weed seeds to the surface.",
							"## Watering plan\nWater slowly at each transplant base, using about 250 ml for a small plug and 400 ml for a larger one. The goal is damp soil around the root ball, not a puddle across the path. Check again after thirty minutes: if the plant has lifted and soil is moist, do not add more. If water runs off immediately, pause, let it soak in, then apply the remainder in two passes.",
							"Rainfall changes the schedule. A short shower may wet leaves while leaving the root zone dry, so check at 3 cm depth before deciding. After soaking rain, skip the next scheduled watering and inspect the low corner for standing water. Record the rain gauge in millimeters; ‘rained yesterday’ is not precise enough to compare with wilt or leaf color.",
							"## Pest and disease observations\nInspect the underside of three leaves per row twice during the first week. Look for slug trails at the bed edge, holes with clean margins, and insect clusters near new growth. Photograph a suspicious leaf beside a ruler before removing anything. A single hole is not a reason to treat the whole bed, and broad sprays would harm pollinators visiting the calendula corner.",
							"If a seedling has a collapsed stem at soil level, remove it with the surrounding plug and place it in household waste rather than shared compost. Clean the trowel with hot soapy water before moving rows. If several plants show the same symptom, pause planting, note the pattern and weather, and ask the coordinator to inspect before any treatment is considered.",
							"## Recordkeeping and review\nAt planting, record date, variety, spacing, compost amount, and weather. One week later, count living plants in each row and note replacements. At four weeks, measure the tallest three plants rather than choosing the best-looking one; this gives a fairer picture of the bed. A simple table is enough: date, rainfall, watering, plant count, and unusual observations.",
							"Compare the north and south beds only after accounting for their previous crops and shade. If lettuce bolts early, record the number of hot afternoons before changing varieties. If brassicas grow slowly, check soil moisture and leaf damage first. Change one factor next season, such as planting date, so the result remains interpretable.",
							"## End-of-season handoff\nLeave healthy roots in place after harvest and cut stems at the surface. Remove labels, netting, and ties so they do not become buried. Return tools clean and dry; report a broken handle rather than hiding it in the crate. Sweep the path, refill the watering can, and leave a note for the next gardener describing what is planted and what needs checking.",
							"The rotation succeeds if both beds remain accessible, mint stays contained, and the next gardener can identify each row without guessing. Yield matters, but it is not the only measure: record whether watering was manageable, paths stayed clear, and spacing reduced disease. Those observations decide whether to repeat the plan or adjust it next autumn.",
							"## Cold-weather protection\nCheck the forecast minimum each evening while seedlings establish. If temperatures may fall below 5°C, cover the north bed with fleece supported above the leaves, securing the corners with clips rather than stones that could crush stems. Remove the cover by midmorning when the air warms; leaving it sealed through a sunny day traps condensation and encourages fungal problems. Record the minimum temperature and whether the cover was used, so any later damage can be interpreted.",
							"For a windy night, inspect the fleece tension before dark. A loose edge can rub against leaves and tear them, while a tightly stretched sheet can pull labels out of soft soil. Use the existing low hoops, leave a small gap at the ends for air movement, and check that the path remains unobstructed. If the wind advisory is severe, skip the cover rather than risking a frame blown into a neighboring plot.",
							"## Shared bed coordination\nThe north and south plots are maintained by different volunteers, so write the agreed rotation on the notice board before planting. Include the date, the person who watered, and any supplies used from the common shelf. Do not move another gardener’s tools or harvest their crop without asking. If a row needs attention while its regular caretaker is away, leave a dated note and send one message through the garden group rather than making several conflicting changes.",
							"Leave the main path at least 90 cm wide for carts and mobility devices. Place the compost bucket on its marked square, return the long fork with its tines facing down, and do not leave a hose stretched across the walkway. These small handoff details prevent trip hazards and make it possible for someone with limited reach to water the near rows independently.",
							"## Harvest thresholds\nPick outer lettuce leaves when each is wider than a hand, leaving the growing center intact. Harvest spinach before flower stalks appear; once a stalk begins to rise, record the date and use the remaining leaves promptly because their texture changes. For brassicas, wait until the head is firm under gentle pressure, but do not squeeze repeatedly because bruised leaves invite rot. Weigh representative harvests in a clean bowl and note whether the amount came from one plant or the full row.",
							"Share surplus through the labeled basket beside the entrance, not by placing food directly on the ground. Include the harvest date and a note that produce should be washed at home. If the basket is full or temperatures are warm, bring the remaining crop to the community kitchen instead of leaving it outside. Never claim produce is allergen-free or pesticide-free unless the growing record supports that statement.",
							"## Soil moisture troubleshooting\nA plant that wilts at midday may recover by evening, so check again in shade before watering. If leaves remain limp at dawn, feel the soil at both the stem and the row edge; a dry root ball beside wet soil suggests water is channeling around the transplant. Make a shallow basin with fingers and apply water slowly in two rounds, waiting five minutes between them. If the soil is already wet, inspect roots for damage and do not add more water as a reflex.",
							"For persistently wet ground, clear the shallow outlet channel with the hand fork without deepening it. Do not trench toward the neighboring plot or direct runoff onto the path. If water remains after a full day without rain, photograph the low point and ask the coordinator before changing the bed grade. A measured drainage problem is easier to solve than an undocumented pile of extra soil that may bury the bed edge.",
							"## Seedling replacement record\nWhen replacing a failed transplant, keep the original label and add a small mark beside the replacement date. Use the same variety if a spare exists; switching varieties mid-row makes later growth comparisons unreliable. Water the replacement separately and note whether it came from the same seed tray or a new packet. If more than one in five plants fails, pause replacements and inspect the common cause before using the remaining seedlings.",
							"Keep a short weekly summary for the coordinator: plant count, notable damage, harvest weight, and one question for the next visit. Avoid vague notes such as ‘everything looks fine’; mention a concrete check such as ‘11 of 12 lettuce plugs upright after 6 mm rain’. These entries help the group distinguish normal variation from a pattern that needs action.",
							"## End-of-season soil cover\nAfter the final harvest, cover bare soil with chopped leaves no deeper than 5 cm, keeping the material away from the timber and mint stems. Use leaves that are dry and free of roadside litter; whole wet leaves form a mat that blocks water. Leave a small marked window in each bed so spring soil can be inspected without removing all the cover. In early spring, rake the leaf layer into the compost only if it has not broken down enough to mix by hand.",
							"The last visit should include a count of reusable labels, clean and dry tools, and a check that the shared water tap is fully closed. Photograph the two beds from the same path position used at planting, then add captions with date and direction. Store the rotation note with those photographs rather than relying on memory; next year’s gardener needs both the plan and evidence of what actually grew.",
						].join("\n\n")}`
					: longGuide,
			type,
			tags:
				entry.tags ??
				(index === 2
					? []
					: [
							...at(spaceTags, spaceIndex, "space tags"),
							...at(sharedTags, index % sharedTags.length, "shared tags"),
						]),
			...(index % 5 === 0
				? { importance: 0 }
				: index % 5 === 1
					? { importance: 1 }
					: index % 5 === 2
						? { importance: 0.6 }
						: {}),
			...(index % 4 === 0
				? { event_time: at(eventDates, (index / 4 + spaceIndex) % eventDates.length, "event date") }
				: {}),
		};
		const svg = entry.attachment ? attachments.get(entry.attachment) : undefined;
		return {
			key,
			create,
			...(entry.revision ? { revision: { body: entry.revision } } : {}),
			...(svg
				? {
						attachment: {
							name: `${entry.attachment}.svg`,
							type: "image/svg+xml",
							body: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" rx="8" fill="#f2ead8"/>${svg}<text x="14" y="112" font-size="10" fill="#354d3c">${space.name}</text></svg>`,
						},
					}
				: {}),
			...(index === 14 ? { trash: true } : {}),
		};
	}),
);
