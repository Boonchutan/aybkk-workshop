#!/usr/bin/env python3
"""
Dali Ashtanga shala model, VERSION 2. Built Mon 23 Nov 2026, after three skeptics read version 1.
Question: what SIZE of shala, what INCOME, which AREA of Dali, should it run at all, and under whose ownership.
All money is CNY unless a line says THB. Plain Python 3, no imports beyond math.

How to read the inputs:
  kind = fact          an official page, a law text, the press or a published price says it
         vendor_claim  a business, a software seller or a trade article says it
         estimate      a sum made from facts (the sum is in the basis text)
         guess         no evidence; a wide low and high are given
  DEMAND inputs have a low, base and high CASE (three pictures of demand).
  FIXED inputs use only "base" in the model; low and high show how unsure the number is.

What changed from version 1 (short list; the output prints the sums):
  - Every settled member now has a named source: taken from a room that exists, or newly made.
  - Rent is a real listing (a whole house), not a rate times a floor that nobody offers.
  - The room is judged alone first. Workshops are a separate line, with the host's cost in it.
  - The area table has a new hard gate (a space that can hold a licence at a known rent) and the
    distance gate became a question: has the teacher who is already there said yes? Not asked yet.
  - Ownership has six cases. The licence case is blocked by law today and counts as 0.
"""
import math

CASES = ["low", "base", "high"]

# Has the teacher of the existing daily Mysore room said a second room is welcome?
# None = nobody has asked. Yesterday's plan asks her by Sun 29 Nov 2026 (step 2b).
WELCOME = None

# ----------------------------------------------------------------------------
# INPUTS
# ----------------------------------------------------------------------------
INPUTS = {

 "money": {
  "thb_per_cny":     dict(base=5.066,     low=5.066, high=5.066, unit="THB per CNY", kind="fact",
                          basis="Rate fetched 22 Nov 2026, used in yesterday's Dali report"),
  "seat_thb":        dict(base=180000,    low=180000, high=180000, unit="THB", kind="fact",
                          basis="One seat of the In-Depth course, before 7% VAT (AYBKK files)"),
  "goal_thb":        dict(base=33000000,  low=33000000, high=34000000, unit="THB a year, net", kind="guess",
                          basis="Planning files put the yearly goal at about 33M THB net and mark it GUESS; the 20 Nov report says about 34M"),
  "cohort_day_thb":  dict(base=72000,     low=72000, high=72000, unit="THB per teaching day, gross", kind="estimate",
                          basis="2,160,000 THB for a full cohort / 30 days, before cohort costs (AYBKK files). Gross, shown for scale only"),
 },

 # ---- demand: three cases ---------------------------------------------------
 "demand": {
  # top-down chain
  "yinqiao_counted":       dict(low=0, base=0, high=1, unit="0 or 1", kind="guess",
                                basis="Only the high case adds Yinqiao: the area table itself fails Yinqiao on people (a car is needed, no dawn bus)"),
  "xiaguan_reach_share":   dict(low=0.0, base=0.0, high=0.10, unit="share", kind="guess",
                                basis="Share of Xiaguan-side residents who would drive 13 km (20 to 27 min, rough sum) for a dawn class"),
  "longstay_near_share":   dict(low=0.10, base=0.20, high=0.35, unit="share", kind="guess",
                                basis="No source counts long-stayers by area. Small-budget long-stayers live at the Old Town's edge and in the lake villages, 5 to 8 km from the foothill"),
  "yoga_rate":             dict(low=0.00213, base=0.00248, high=0.00461, unit="share of people", kind="vendor_claim",
                                basis="iResearch 2021 (old): 3.0 to 3.5 million core studio users, plus about 3 million steady via gyms and online, over 1.41 billion people"),
  "local_factor":          dict(low=0.5, base=1.0, high=2.0, unit="times the national rate", kind="guess",
                                basis="The map ratio is 1.36 with the 6 real studios and 2.26 with all 10 entries (the script prints both). 65.8% of China's yoga users are in first- and second-tier cities (2018), so a county-level city starts below the national rate"),
  "daily_traditional_share": dict(low=0.01, base=0.02, high=0.05, unit="share of steady yoga people", kind="guess",
                                basis="No survey gives an Ashtanga share; 2018 survey: 39.0% no strict style, 20.1% Hatha; 32 listed teachers against 300,000+ yoga teachers on the mainland"),
  "pay_share_residents":   dict(low=0.05, base=0.15, high=0.35, unit="share", kind="guess",
                                basis="No source. For scale only: 1,500 CNY is 35% of Dali City urban income per person a month (4,250), 43% for all residents (3,528), 71% of the 2,120 minimum wage. That is a price-to-income ratio, not a share of people"),
  "pay_share_longstay":    dict(low=0.05, base=0.10, high=0.30, unit="share", kind="guess",
                                basis="No source. 1,500 is 37% of a 'comfortable' long-stay budget of 4,100 a month and 68% of a thrifty 2,200 (compiled article, weak); a community founder says healing brings mostly passers-by"),
  # bottom-up: month members in the rooms that exist today
  "existing_room_listed":  dict(low=3, base=5, high=10, unit="month members", kind="guess",
                                basis="Class size is not published. The only Dali head count is 2 to 10 in a class at another yard (2022), and a class count includes week-card visitors. The room cut its teaching window from 3 h (2024) to 1 h 45 (2026) and its week and single prices"),
  "existing_room_courtyard": dict(low=0, base=1, high=3, unit="month members", kind="guess",
                                basis="Lakeside courtyard: daily Mysore notice seen once (26 Mar 2024), week card only; it lives on courses and retreats"),
  "existing_room_third":   dict(low=0, base=0, high=0, unit="month members", kind="guess",
                                basis="Shengjiu village yard: 'a Mysore of ten' in 2022; no trace since 14 May 2024 (30 months)"),
  # where the new room's settled members come from
  "switch_share":          dict(low=0.10, base=0.20, high=0.40, unit="share of the existing rooms' month members who move to the new room", kind="guess",
                                basis="No evidence. Every one of them is taken from a teacher who is already there"),
  "new_practitioners":     dict(low=0, base=1, high=2, unit="month members newly made by month 24", kind="guess",
                                basis="Beginners who become month payers. The step is steep: Dali trial classes cost 19.9 to 62.5 CNY and a free Sunday class ran for 15 months"),
  "unserved_capture":      dict(low=0.0, base=0.0, high=0.0, unit="share of (top-down pool less bottom-up pool) the new room wins", kind="guess",
                                basis="Set to 0: the top-down chain cannot be checked, so the model does not draw members from it. The unserved number is printed for the reader"),
  "long_stayers":          dict(low=0, base=0.5, high=2, unit="on a month pass in a middle month", kind="guess",
                                basis="0.5 = one long-stayer on a pass for half the year. Visitors find a room through the Sharath Yoga Centre list (one Dali entry) and the local events guide; both point to the listed room"),
  "visitor_weeks_per_month": dict(low=0.5, base=1, high=4, unit="week cards in a middle month", kind="guess",
                                basis="No week-card count exists. The listed room cut its week card from 900 to 600 while long-stay numbers rose 24.89%; a retreat in Dali was offered with 12 places (an offer, not a sale)"),
  "drop_ins_per_month":    dict(low=1, base=3, high=10, unit="single classes in a middle month", kind="guess",
                                basis="No count exists; drop-in is for visitors who know the sequence. The listed room cut its single class from 200 to 150"),
  # workshops by a visiting teacher (Boonchu in the ownership cases)
  "workshops_per_year":    dict(low=1, base=1, high=2, unit="5-day workshops", kind="guess",
                                basis="The 2026 China stops ran once per city (8 stops, 8 cities)"),
  "workshop_heads_wanted": dict(low=5, base=7, high=16, unit="students who would pay, before any room limit", kind="guess",
                                basis="No head count exists for any Dali workshop. Offers seen: 12 places, limits of 15 and 16, caps of 20 to 25. Base 7 includes the room's own members; high 16 is a limit seen in Dali"),
  "workshop_price":        dict(low=3500, base=3680, high=4280, unit="CNY per student, 5 days", kind="fact",
                                basis="3,500 group and 3,680 early price for a listed visiting teacher in Kunming (Jun 2024); 4,280 early price for the first 10 at a Dali workshop (Jun 2022). Small groups all fall inside the early price"),
  "room_hire_per_year":    dict(low=0, base=0, high=4000, unit="CNY a year", kind="guess",
                                basis="A Dali studio is billed as a 'classroom venue fee' in a visiting group's trip (Mar 2026); the amount is not shown"),
 },

 # ---- inputs with one value in the model (low and high = how unsure) ---------
 "fixed": {
  # people
  "dali_town_residents":   dict(base=95442,  low=95442,  high=95442,  unit="people", kind="fact", basis="2020 census (old), Dali Town: Old Town and foothill estates"),
  "yinqiao_residents":     dict(base=27090,  low=27090,  high=27090,  unit="people", kind="fact", basis="2020 census (old)"),
  "xiaguan_side_residents": dict(base=395041, low=395041, high=395041, unit="people", kind="fact", basis="2020 census (old): Xiaguan 146,517 + Taihe 145,226 + Manjiang 103,298"),
  "longstay_city_period":  dict(base=250500, low=200000, high=250500, unit="people in Jan to Sep 2026", kind="estimate", basis="333,700 in the prefecture x 75.07% Dali City share; a second source says nearly 200,000 for the first half of 2026"),
  "longstay_avg_days":     dict(base=77.26,  low=77.26,  high=77.26,  unit="days", kind="fact", basis="Average long stay, prefecture, Jan to Sep 2026 (Xinhua). A mean of a skewed spread: the usual stay is shorter"),
  "longstay_period_days":  dict(base=273,    low=273,    high=273,    unit="days", kind="fact", basis="Days from 1 Jan to 30 Sep"),
  "national_yoga_venues":  dict(base=42350,  low=42350,  high=42350,  unit="venues", kind="vendor_claim", basis="iResearch 2021 (old)"),
  "china_population":      dict(base=1410000000, low=1410000000, high=1410000000, unit="people", kind="estimate", basis="Rounded, as in the evidence file"),
  "oldtown_side_studios":  dict(base=6,      low=6,      high=10,     unit="venues", kind="estimate", basis="360 map, read 23 Nov 2026: 10 yoga or Pilates entries on the Old Town side; 2 are lodging businesses and 2 are teacher-training schools, so 6 local studios. None is proven open"),
  # prices
  "price_month_list":      dict(base=1300, low=1000, high=1500, unit="CNY a month", kind="fact", basis="The listed Dali room's Mysore-only month price is 1,300 (1,500 includes a daily pranayama class by a Level 2 teacher). A room that is not on the list cannot charge more for the same class"),
  "price_resident_month":  dict(base=1100, low=1000, high=1300, unit="CNY a month, average paid by settled members", kind="estimate", basis="The listed room charges 1,000 after ten months. At a 33.6% yearly loss 71% of settled members are past ten months: 0.71 x 1,000 + 0.29 x 1,300 = 1,087. Low 1,000 = every settled member on the long-stay price"),
  "price_week":            dict(base=600,  low=500,  high=900,  unit="CNY a week", kind="fact", basis="Both Dali rooms: 600 a week (2024, 2026)"),
  "price_drop_in":         dict(base=150,  low=120,  high=200,  unit="CNY a class", kind="fact", basis="Listed Dali room 150 (2026); courtyard 120 (2024)"),
  "course_income_year":    dict(base=0,    low=0,    high=24000, unit="CNY a year", kind="guess", basis="NOT counted. A month-long course of 4 at 6,000 CNY would add 24,000, but it copies the In-Depth format at 16.9% of one seat and nothing shows that Dali courses fill"),
  "workshop_host_share":   dict(base=0.30, low=0.30, high=0.50, unit="share of workshop gross kept by the host", kind="vendor_claim", basis="Yoga Australia article (27 May 2025): 70/30 called usual, 60/40 and 50/50 also seen. Anecdotes, not China. Example only; AYBKK's own split is private: [AYBKK share], [host share]"),
  "ws_host_cost":          dict(base=8000, low=5000, high=12000, unit="CNY the host pays per workshop", kind="guess", basis="AYBKK's written policy says the host pays travel, lodging, meals, venue, ads and translator. My guess for Dali: a flight via Kunming, 7 nights, meals, a translator. The real figure is in AYBKK's own stop ledgers: [host cost per stop]"),
  # season and calendar
  "busy_months":           dict(base=3,    low=2.6,  high=5,    unit="months a year", kind="guess", basis="Peak season is about 80 days a year (2.6 months, trade article): Spring Festival, summer holiday, National Day; no studio season series exists"),
  "busy_factor":           dict(base=1.42, low=1.2,  high=2.0,  unit="times a middle month", kind="guess", basis="For long-stayers and visitors only; residents stay flat"),
  "quiet_factor":          dict(base=0.70, low=0.5,  high=0.85, unit="times a middle month", kind="guess", basis="A self-media article (weak, labelled AI-made) says occupancy near 30% in March and November"),
  "open_weeks":            dict(base=44,   low=26,   high=48,   unit="weeks a year", kind="guess", basis="One teacher and no cover teacher: when the teacher is away the room is shut. The existing room printed a term of 4 Jan to 3 Jul 2026 only (26 weeks)"),
  "longstay_months_on_pass": dict(base=1.5, low=1.0, high=2.54, unit="months", kind="guess", basis="77.26 days is 2.54 months; they do not find the room on the first day and the usual stay is shorter than the mean"),
  "resident_yearly_loss":  dict(base=0.50, low=0.336, high=0.70, unit="share of settled members who leave in a year", kind="guess", basis="Global gyms lose 33.6% a year (HFA 2024, not yoga, not China). Dali newcomers move on more than gym members do"),
  "replace_gap_months":    dict(base=3,    low=1,    high=6,    unit="months a place stays empty before a new member is found", kind="guess", basis="No evidence"),
  "refund_share":          dict(base=0.03, low=0.01, high=0.08, unit="share of pass sales paid back", kind="guess", basis="Supreme People's Court rules on prepaid passes (in force 1 May 2025; opened by the checker, not by me): money back within 7 days (Art. 14); the buyer may cancel if an 'unlimited' service is not given normally (Art. 13); used classes then count at the discounted price (Art. 18)"),
  # the room
  "m2_per_mat":            dict(base=3.0,  low=2.5,  high=3.0,  unit="m2", kind="vendor_claim", basis="bsport: 2.5 to 3 m2 for dynamic yoga, names Ashtanga; Virtuagym: 27 sq ft = 2.5 m2"),
  "practice_share_of_floor": dict(base=0.57, low=0.50, high=0.77, unit="share", kind="fact", basis="Mysore House Madrid: 170 m2 practice room in 300 m2 total. One shala"),
  "window_hours":          dict(base=2.5,  low=2.0,  high=3.0,  unit="hours", kind="guess", basis="Dali rooms: 2 hours (9:00 to 11:00) and 3 hours (7:00 to 10:00)"),
  "mat_hours":             dict(base=1.5,  low=1.25, high=1.75, unit="hours on the mat", kind="guess", basis="Assumption in the benchmark sum from the evidence"),
  "attend_share":          dict(base=0.83, low=0.60, high=0.90, unit="share of practice days a member comes", kind="guess", basis="5 days of 6; US essay says 5 to 6 days a week"),
  "comfort_fill":          dict(base=0.80, low=0.70, high=1.00, unit="share of mat turns sold", kind="guess", basis="Do not sell the last places; people cluster at the same hour"),
  "students_per_teacher":  dict(base=25,   low=15,   high=30,   unit="students across one morning", kind="vendor_claim", basis="US essay (2013): a Mysore programme brings about 25 students in a three-hour window"),
  # set-up cost
  "fitout_per_m2":         dict(base=800,  low=500,  high=1500, unit="CNY per m2 of floor the room uses", kind="guess", basis="500 is a franchise-leads template for a county-level city (undated vendor claim); 1,500 is the low end of founders' all-in figures from 2016 to 2017. No Dali figure found"),
  "bare_room_fitout":      dict(base=10000, low=3000, high=20000, unit="CNY", kind="guess", basis="A home room as it is: a floor covering, a heater, a sign. No evidence"),
  "props_per_mat":         dict(base=300,  low=150,  high=500,  unit="CNY per mat place", kind="guess", basis="Spare mats, rugs, shelves, a door tablet; students bring their own mat"),
  "heating_kit_per_m2":    dict(base=175,  low=100,  high=300,  unit="CNY per m2 of practice room", kind="guess", basis="One heat-pump unit of about 3,500 CNY per 20 m2; January average low is 3.1 C"),
  "papers_home_cny":       dict(base=2000, low=500,  high=5000, unit="CNY", kind="guess", basis="Licence for a Chinese owner's individual business, plus an agent. In a home the pre-opening fire step cannot be done, so the room would run without it. Whether Dali registers a licence at a home address was not found"),
  "papers_shop_cny":       dict(base=8000, low=2000, high=20000, unit="CNY", kind="guess", basis="Shop unit: licence, agent, extinguishers, exit lights, signs, a test report if asked. A paid yoga room may count as a 'commercial fitness and leisure place' (police ministry Order 39); opening without the fire step costs 30,000 to 300,000"),
  "papers_wfoe_cny":       dict(base=40000, low=20000, high=80000, unit="CNY", kind="guess", basis="Foreign-owned company: agent, legalised papers, bank; steps and fees for Dali not found"),
  "opening_marketing":     dict(base=3000, low=1000, high=8000, unit="CNY", kind="guess", basis="Photos, print, opening week"),
  "prelaunch_rent_months": dict(base=1.5,  low=1.0,  high=3.0,  unit="months of rent paid during the fit-out", kind="guess", basis="No evidence"),
  "agent_fee_months":      dict(base=1.0,  low=0.0,  high=1.0,  unit="months of rent", kind="guess", basis="Usual agent fee; most foothill listings are agent posts"),
  "restore_share":         dict(base=0.10, low=0.0,  high=0.20, unit="share of the fit-out cost, paid at the end to hand the space back as it was", kind="guess", basis="No evidence"),
  "deposit_months":        dict(base=1,    low=1,    high=3,    unit="months of rent", kind="fact", basis="One Xiaguan home listing: one month deposit, three months paid at a time; shop deposits 2,000 to 3,000 in Xiaguan, 50,000 to 100,000 on Renmin Road"),
  "advance_rent_months":   dict(base=12,   low=3,    high=24,   unit="months", kind="fact", basis="Business and courtyard adverts: rent paid once a year, some two years at a time"),
  "lease_years_home":      dict(base=2,    low=1,    high=5,    unit="years", kind="guess", basis="A home in an estate is let by the year; the owner can end it or raise the rent after the tenant has laid the floor"),
  "lease_years_shop":      dict(base=3,    low=3,    high=5,    unit="years", kind="fact", basis="Renmin Road shop advert asks a 3-year minimum term"),
  "rent_rise_year":        dict(base=0.05, low=0.0,  high=0.10, unit="share a year", kind="guess", basis="Two adverts sell 'no rise' as a plus, so rises are usual; no percentage found"),
  "reserve_months":        dict(base=6,    low=3,    high=12,   unit="months of running cost without rent", kind="guess", basis="Cash to carry the first year while members build up"),
  "ramp_months":           dict(base=24,   low=12,   high=36,   unit="months to reach steady numbers", kind="guess", basis="The listed room has had five years to reach its guessed level; a new Mysore programme may start with five people (Portland teacher, 2011)"),
  # real spaces used as named cases
  "oldtown_building_rent": dict(base=6667, low=6667, high=6667, unit="CNY a month", kind="fact", basis="Boai gate, first building inside the Old Town: whole building, floors 1 to 4, about 200 m2, 80,000 a year (0872.com, 5 Aug 2026). Transfer fee 'very low', amount not stated. No single large room is shown"),
  "shop_unit_rent_per_m2": dict(base=48.1, low=27.0, high=55.7, unit="CNY per m2 a month", kind="estimate", basis="Version 1's rate (a 208 m2 house at 10,000). No ground-floor shop unit of about 53 m2 was found in the foothill belt"),
  "b_listing_rent":        dict(base=13000, low=13000, high=13000, unit="CNY a month", kind="fact", basis="Xiaoyuanzi south villa, 324 m2 (Fang.com, about Dec 2024, old): the only priced listing inside area B"),
  # running cost
  "property_fee_per_m2":   dict(base=2.0,  low=0.0,  high=2.0,  unit="CNY per m2 a month", kind="fact", basis="2 and 1.5 on two Xiaguan commercial listings; not stated for the foothill estates"),
  "utilities_per_m2":      dict(base=10.0, low=6.0,  high=15.0, unit="CNY per m2 a month", kind="vendor_claim", basis="Franchise-leads template: 1,500 a month for 150 m2 in a county-level city (undated). Water, light, internet"),
  "kwh_price":             dict(base=0.70, low=0.45, high=0.85, unit="CNY per kWh", kind="guess", basis="Yunnan small-business price not found; other provinces show about 0.70 to 0.75 in search summaries (unverified)"),
  "heat_kw_per_m2":        dict(base=0.10, low=0.06, high=0.15, unit="kW per m2 of practice room", kind="guess", basis="Rule of thumb for an uninsulated room"),
  "heat_hours_per_day":    dict(base=3.5,  low=2.5,  high=5.0,  unit="hours", kind="guess", basis="One hour before class plus the 2.5-hour window"),
  "heat_months":           dict(base=4,    low=3,    high=5,    unit="months", kind="guess", basis="December to March; mean daily low 3.1 C in January and 3.5 C in December (fact)"),
  "practice_days_per_month": dict(base=26, low=24,   high=26,   unit="days", kind="estimate", basis="Six days a week, less moon days"),
  "teacher_pay":           dict(base=6000, low=4000, high=9000, unit="CNY a month the owner-teacher draws", kind="guess", basis="Adverts: yoga and Pilates teacher 3,000 to 6,000 at normal effort (Xiaguan, 2022); yoga coach 2,000 to 10,000 (Feb 2026, employer not shown). No paid wage found"),
  "hired_teacher_pay":     dict(base=8000, low=6000, high=10000, unit="CNY a month for a hired teacher who runs the room alone (case a)", kind="guess", basis="A teacher who opens alone six mornings a week, sells, cleans up and posts is not the 6,000 class-teacher job; gym coach adverts run 5,000 to 10,000, often with food and a bed. Nobody in Dali is known who could be hired"),
  "assistant_pay":         dict(base=3500, low=3000, high=6000, unit="CNY a month", kind="guess", basis="Low end of the same adverts, mornings only"),
  "hourly_wage":           dict(base=21,   low=21,   high=30,   unit="CNY an hour", kind="fact", basis="Yunnan minimum wage, class 2 areas, from 1 Sep 2026; Dali City is class 2 by the rule's wording"),
  "min_wage_month":        dict(base=2120, low=2120, high=2120, unit="CNY a month", kind="fact", basis="Yunnan minimum wage, class 2 areas, from 1 Sep 2026"),
  "si_rate":               dict(base=0.26, low=0.20, high=0.35, unit="employer's social insurance as a share of the wage", kind="guess", basis="Employer rates for Yunnan were not found"),
  "si_base_floor":         dict(base=4357, low=4357, high=4357, unit="CNY a month", kind="vendor_claim", basis="Lowest wage on which contributions are charged (one self-media article, low confidence). A wage above it is charged on the wage itself"),
  "owner_si_month":        dict(base=1133, low=871,  high=1560, unit="CNY a month for the owner-teacher's own pension and medical", kind="guess", basis="871 = 20% pension on the 4,357 floor; 1,133 = 26% on the floor; 1,560 = 26% on 6,000"),
  "marketing_month":       dict(base=500,  low=200,  high=1500, unit="CNY a month", kind="guess", basis="WeChat and Xiaohongshu posts cost time, not cash; no paid ads (house rule)"),
  "payment_fee":           dict(base=0.006, low=0.0038, high=0.01, unit="share of takings", kind="fact", basis="WeChat Pay merchant fee 0.6% to 1%; micro merchants 0.38% to 0.6%"),
  "insurance_year":        dict(base=2000, low=1000, high=5000, unit="CNY a year", kind="guess", basis="No premium found for a yoga studio in China"),
  "bookkeeping_month":     dict(base=250,  low=170,  high=300,  unit="CNY a month", kind="vendor_claim", basis="Unverified: agents' adverts in a search summary: 200 to 300 a month for a small-scale taxpayer (Nanning). Not Dali"),
  "bookkeeping_company_month": dict(base=600, low=400, high=800, unit="CNY a month", kind="guess", basis="A company files more than an individual business"),
  "wfoe_audit_year":       dict(base=6000, low=3000, high=10000, unit="CNY a year", kind="guess", basis="Dividends leave only with audited accounts and tax proof"),
  "wfoe_exit_fixed":       dict(base=15000, low=10000, high=30000, unit="CNY to close a foreign-owned company", kind="guess", basis="Tax clearance and deregistration; no Dali figure"),
  "vat_threshold_month":   dict(base=100000, low=100000, high=100000, unit="CNY of sales a month", kind="fact", basis="MOF and STA Announcement 2026 No. 10: no VAT under 100,000 a month, to 31 Dec 2027; reaching it puts VAT on the whole month"),
  "vat_rate":              dict(base=0.01, low=0.01, high=0.03, unit="share", kind="fact", basis="1% for small-scale taxpayers to 31 Dec 2027"),
  "vat_rate_after_2027":   dict(base=0.03, low=0.01, high=0.03, unit="share", kind="fact", basis="3% is the normal small-scale rate if the relief is not renewed"),
  "iit_allowance":         dict(base=60000, low=0, high=60000, unit="CNY a year", kind="guess", basis="Personal allowance an owner with no other income deducts. From the checker's memory, NOT opened; ask the bookkeeper"),
  "iit_business_halved":   dict(base=0.5,  low=0.5,  high=1.0,  unit="factor", kind="fact", basis="Individual business income tax (5% to 35% bands) is halved on the first 2 million CNY, to 31 Dec 2027"),
  "company_tax_rate":      dict(base=0.05, low=0.05, high=0.25, unit="share of profit", kind="fact", basis="Small low-profit company: 25% counted x 20%, to 31 Dec 2027"),
  "company_reserve_share": dict(base=0.10, low=0.0,  high=0.10, unit="share of profit after tax kept in the company", kind="guess", basis="Company Law reserve before a dividend (from the checker's memory, not opened)"),
  "dividend_tax_person":   dict(base=0.20, low=0.10, high=0.20, unit="share", kind="estimate", basis="20% for a foreign person who holds the shares (the checker's reading of the income tax law; a tax adviser must confirm); 10% if a Thai company holds them (PwC)"),
  "licence_fee_net_share": dict(base=0.8491, low=0.8491, high=0.8491, unit="share that arrives", kind="estimate", basis="100 / 1.06 x 6% VAT = 5.66; 10% withholding on 94.34 = 9.43; 100 - 5.66 - 9.43 = 84.91. Fee paid to a Thai company"),
  # published norms used as EXAMPLES (NOT AYBKK terms)
  "example_royalty":       dict(base=0.07, low=0.07, high=0.09, unit="share of the shala's sales", kind="vendor_claim", basis="YogaSix (US franchise): 7% royalty plus 2% brand fund. Example only; AYBKK has no licence terms: [licence fee]"),
  "example_teacher_share": dict(base=0.70, low=0.50, high=0.70, unit="share of workshop gross to the visiting teacher", kind="vendor_claim", basis="Yoga Australia 70/30 norm. Example only for [AYBKK share]"),
  "example_studio_share":  dict(base=0.40, low=0.30, high=0.50, unit="share of daily sales a host studio keeps for the room", kind="vendor_claim", basis="Same Yoga Australia article: 30%, 40% and 50% all occur. Example only; any real split is private: [partner share]"),
  # Boonchu's days
  "workshop_trip_days":    dict(base=7,    low=7,    high=8,    unit="days away per workshop", kind="estimate", basis="5 teaching days plus one travel day each way (yesterday's report)"),
  "wfoe_setup_days":       dict(base=21,   low=14,   high=40,   unit="days in year 1", kind="guess", basis="Three trips of 7 days for papers, lease and fit-out"),
  "wfoe_manage_days":      dict(base=10,   low=5,    high=20,   unit="days a year", kind="guess", basis="A company in another country does not run itself: teacher, landlord, bank, tax"),
  "licence_support_days":  dict(base=5,    low=2,    high=10,   unit="days a year", kind="guess", basis="Teaching the owner the room rules and the habit system; part can be remote"),
  "china_days_2026":       dict(base=33,   low=33,   high=33,   unit="teaching days", kind="fact", basis="2026 China workshop pages, April to August (yesterday's report)"),
  "china_stops_2026":      dict(base=8,    low=8,    high=8,    unit="stops", kind="fact", basis="Eight city pages in the repo"),
  "visa_free_days":        dict(base=90,   low=90,   high=90,   unit="days in any 180", kind="fact", basis="Thai passports: 30 days a stay, 90 in any 180; does not cover work"),
 },

 # ---- sizes ------------------------------------------------------------------
 "sizes": {
  "micro":  dict(mats=6,  mats_low=5,  mats_high=8,  helper_hours=0,   cleaning_hours=16),
  "small":  dict(mats=10, mats_low=8,  mats_high=12, helper_hours=0,   cleaning_hours=26),
  "medium": dict(mats=20, mats_low=16, mats_high=24, helper_hours=78,  cleaning_hours=39),
  "large":  dict(mats=36, mats_low=30, mats_high=40, helper_hours=156, cleaning_hours=65),
 },

 # ---- the five real whole spaces found in the foothill estates (asking rents) --
 "listings": [
  dict(m2=180, rent=5500,  where="Shanshuijian estate (area A2), ground floor of 3, a home with 3 bedrooms", src="Fang.com, updated 3 Oct 2026"),
  dict(m2=208, rent=10000, where="Shanshuijian estate (area A2), ground floor of 3, a home with 4 bedrooms", src="Fang.com, updated 19 Oct 2026"),
  dict(m2=257, rent=7200,  where="Dali University villa estate (foothill), a home with 7 rooms", src="Fang.com, about Apr 2026"),
  dict(m2=270, rent=7300,  where="Shanshuijian phase 1 east gate (area A2), one floor, offered for business use, rent includes property fee, water, power, internet; the advert does not say if it is a shop unit", src="0872.com, 21 Jul 2026"),
  dict(m2=324, rent=13000, where="Xiaoyuanzi south (area B), a villa with 7 rooms", src="Fang.com, about Dec 2024, old"),
 ],

 # ---- areas: scores 1 (worst) to 5 (best) -------------------------------------
 # space = True when a space that can hold a business licence was found at a known rent
 "area_weights": dict(people=4, reach=2, rules=2, lease=2, distance=2, rent=1, lodging=1, heat_noise=1),
 "area_gates":   dict(people=3, rules=2),
 "areas": [
  dict(key="A2", name="Foothill belt next to the Old Town: Shanshuijian (山水间) gates, Hongsheng Road, Gantong",
       rent=4, people=5, reach=4, rules=2, lodging=4, lease=2, heat_noise=2, distance=2, space=False,
       space_text="Not proven. The four cheap whole houses (5,500 to 10,000 a month) are homes. One 270 m2 space is offered for business use at 7,300 all-in, but the advert is four months old and does not say if it is a shop unit",
       rent_text="27 to 48 CNY per m2 a month for whole spaces of 180 to 270 m2 (Fang.com and 0872.com, Apr to Oct 2026). The model uses the cheapest: 180 m2 at 5,500 a month (30.6 per m2 of the house)",
       near="The densest cluster found: the existing Mysore room, 2 more yoga studios, 4 gyms and a dance studio; settled newcomers in estates built from 2014",
       pros="The target people live here; every cheap real listing is here; 2 km from the south gate by one advert; bus stops for lines 4 and 19; parking",
       cons="The same belt as the only listed Mysore room, so it rests on that teacher's welcome. The spaces are homes: business use needs the consent of the affected neighbours (Civil Code Art. 279), a home is let year by year, and the pre-opening fire step cannot be done in a dwelling"),
  dict(key="A1", name="Shanshuijian phase 3 / Dali Art Garden (大理艺术家园): the existing room's own estate",
       rent=4, people=5, reach=4, rules=2, lodging=4, lease=2, heat_noise=2, distance=1, space=False,
       space_text="Not found. Unit rents inside the Art Garden were not found",
       rent_text="Homes in Shanshuijian ask 2,500 to 48,000 a month, middle value 7,100 (32 listings on one page)",
       near="The existing Mysore room and 2 more yoga studios are in this estate",
       pros="Where the practice base already lives",
       cons="Next door to the teacher who is already there: it splits one small base. Homes only"),
  dict(key="E",  name="Villages at the Old Town's west and north edge: Congyuan, Dazhifang, Sanwenbi, Shang and Xia Jiyi",
       rent=3, people=4, reach=3, rules=2, lodging=4, lease=2, heat_noise=3, distance=4, space=False,
       space_text="Not found. One priced yard (9 rooms, 238,000 a year, two years up front) is a guesthouse lease; a village house needs a legal change of use",
       rent_text="No per-m2 rent. Rooms 500 to 2,000 a month (Feb 2024)",
       near="Digital nomads and young long-stayers: a co-living house at Congyuan, co-working sites at Dazhifang and Sanwenbi; an Iyengar centre and a gym branch nearby",
       pros="The target people walk or ride from here; about 10 minutes on foot from the west gate (Congyuan); a courtyard has no shared walls",
       cons="Small budgets (rooms from 500 a month); one seller says a house with no yard cannot be licensed; a takeover needs the owner's written consent (Civil Code Art. 716); lanes with scarce parking"),
  dict(key="D",  name="Bedsheet Factory art district (床单厂艺术区), 56 Cangping Street, inside the Old Town",
       rent=3, people=4, reach=2, rules=2, lodging=5, lease=3, heat_noise=3, distance=3, space=False,
       space_text="Not found: one operator holds the whole site and sets rents case by case. A proper tenant site, so a licence address is likely; the rent must be asked",
       rent_text="Unit rents not found (one year of rent subsidy for chosen makers)",
       near="103 creative brands, 150+ craftspeople, 65% of workers are long-stayers, about 500,000 visits in 2025; no yoga tenant found",
       pros="A proper tenant site with a named operator; long-stayers work here every day; guesthouses all around",
       cons="Heritage rules apply; rent unknown; a sub-lease from the operator; parking is scarce inside the walls; daytime crowds"),
  dict(key="B",  name="Foothill south: Xiaoyuanzi (大理的小院子) and Canghai Yishu (苍海一墅) strip, west of the G214 road",
       rent=3, people=4, reach=4, rules=2, lodging=3, lease=2, heat_noise=2, distance=3, space=False,
       space_text="Not found. The only priced listing is a 324 m2 villa at 13,000 a month (a home, two years old). A listed studio sits on a second floor in the lane 大理的小巷子 (Xiaoyuanzi phase 5); unit type and rent not found",
       rent_text="40.1 CNY per m2 a month (324 m2 at 13,000, Fang.com, about Dec 2024, old). Nothing small is priced",
       near="Settled newcomers in gated estates; 2 yoga studios here, one lists Ashtanga and has hosted a visiting teacher's Mysore week and 5-day Ashtanga workshops; a school with Mysore in its name 0.7 km away (what it teaches was not confirmed)",
       pros="About 3 km from the existing Mysore room; parking inside estates; outside the heritage core",
       cons="Not free of Ashtanga supply (see who is near), so the 3 km is not real distance. Homes: neighbours' consent and a licence address are open. Title: a 2020 press report says 55 villas of a 'Canghai' golf resort at the foot of Cangshan were taken and pulled down for lack of approvals; whether that is this estate was not confirmed. Long-stayers on small budgets live 5 to 8 km away"),
  dict(key="C",  name="Old Town inside the walls (Renmin Road, Boai Road, Hongwu Road and back streets)",
       rent=2, people=3, reach=2, rules=2, lodging=5, lease=2, heat_noise=2, distance=3, space=True,
       space_text="Found: shop units at asking rents. Boai gate whole building, about 200 m2 on 4 floors, 80,000 a year (6,667 a month); Boai Road 30 m2 at 2,500 a month; Renmin Road 69 to 110 m2 at 15,000 to 29,000 a month",
       rent_text="33 to 264 CNY per m2 a month (four adverts, Jul to Sep 2026): Renmin Road 182 to 264; Boai Road 83; the Boai gate building 33",
       near="Tourists first (over 22 million visits Jan to Jul 2026), shopkeepers, some long-stayers; 95,442 residents in Dali Town (2020)",
       pros="The only area with some target people AND shop units at known rents; most lodging for visitors, from 50 to 300 CNY a night; walkable for people who live inside",
       cons="Dearest rent per m2; transfer fees of 90,000 to 580,000 and deposits of 50,000 to 100,000 on main streets; heritage rules on fronts and signs; street clean-up drives in 2024 and Aug 2026; no bus before 6:30; old buildings, night noise; no large single room shown"),
  dict(key="K",  name="Xiaguan city (下关): Tai'an Road, Xingsheng Road, Manjiang, north district",
       rent=4, people=2, reach=4, rules=4, lodging=3, lease=4, heat_noise=3, distance=5, space=True,
       space_text="Found: ordinary street shops at 18 to 71 CNY per m2 a month; an upstairs 417 m2 shell at 43",
       rent_text="18 to 71 CNY per m2 a month for ordinary street shops; hospital-front shops ask 196 to 400 and sit unlet",
       near="About 395,000 residents (2020), offices, hospitals, schools; 3 yoga or Pilates places; old gym prices of about 133 a month",
       pros="Proper shop units, clear licence address, ordinary leases with small deposits, parking, 13 km from the existing room",
       cons="Not a newcomer area, local wallets, 'no Dali feel'. A room here would be a lower-priced local room, a different business"),
  dict(key="J",  name="Fengyangyi and Taihe village (between the Old Town and Xiaguan)",
       rent=4, people=2, reach=3, rules=3, lodging=3, lease=3, heat_noise=3, distance=4, space=False,
       space_text="Not found: no business listing",
       rent_text="Rooms 600 to 900 a month in Taihe village; homes 3,500 to 6,500 in Fengyangyi (a guesthouse's own guide)",
       near="Named for digital nomads by a guesthouse that sits there; no studio found",
       pros="On bus lines 4 and 8; cheap rooms",
       cons="Weak services, 6 km from the Old Town, demand rests on one marketing page"),
  dict(key="G",  name="Yinqiao (银桥): Panxi, Majiuyi, Heyang, Shangyin villages",
       rent=5, people=2, reach=2, rules=2, lodging=3, lease=3, heat_noise=4, distance=4, space=False,
       space_text="Not found: whole village houses, no per-m2 rent; one seller says a house with no yard cannot be licensed",
       rent_text="Whole houses 28,000 to 60,000 CNY a year (2,300 to 5,000 a month), plus transfer fees of 15,000 to 420,000",
       near="27,090 residents (2020); settled newcomers in rented courtyards; two yoga guesthouses",
       pros="Cheapest whole houses near the Old Town; leases with 12 to 16 years left; quiet",
       cons="A car is needed, no dawn bus. Fits a live-in house, which falls under the guesthouse law; the lakeside part is in the Erhai zones"),
  dict(key="O",  name="Fengyi (凤仪), east of Xiaguan by the airport",
       rent=3, people=1, reach=2, rules=4, lodging=2, lease=4, heat_noise=3, distance=5, space=False,
       space_text="Not found: one upstairs shop of 150+ m2, rent not stated",
       rent_text="Rent not stated",
       near="67,766 residents (2020); a local market town; no yoga or newcomer venue found",
       pros="Ordinary town rules",
       cons="No target people found"),
  dict(key="F",  name="Lakeside villages east of the Old Town: Caicun, Longkan, Shengjiu",
       rent=3, people=4, reach=2, rules=1, lodging=4, lease=1, heat_noise=3, distance=3, space=False,
       space_text="Not found: no business listing",
       rent_text="Rooms 1,200 to 1,800 a month in the quiet season; homes 2,800 to 4,500 (a guesthouse's guide)",
       near="The most-chosen villages for long-stayers; one guide calls Caicun a 'yoga community'; a nomad community by Shengjiu",
       pros="The target people live here",
       cons="Erhai Level 1 within 100 m of the water and Level 2 behind it allow no new building or extension; in 2017 more than 2,000 lakeside businesses were stopped"),
  dict(key="I",  name="Xizhou (喜洲)",
       rent=3, people=2, reach=1, rules=2, lodging=4, lease=3, heat_noise=3, distance=5, space=False,
       space_text="Not found: street shops of 55 to 400 m2 with no rent stated",
       rent_text="Homes 4,000 to 8,000 a month, doubling in peak season",
       near="54,779 residents (2020); families with school-age children, two-city workers, tourists",
       pros="A real town with its own visitors",
       cons="Far from the Old Town; under the heritage law"),
  dict(key="L",  name="North Xiaguan lakeside villages: Daguanyi, Xiaoguanyi, Erbin",
       rent=4, people=1, reach=3, rules=2, lodging=2, lease=3, heat_noise=3, distance=5, space=True,
       space_text="Found: a 400 m2 three-floor restaurant building with full licences at 10,000 a month (25 per m2)",
       rent_text="25 CNY per m2 a month (one building); an 8-room yard at 68,000 a year",
       near="Locals and day visitors at the corridor entrance; no yoga or newcomer venue found",
       pros="Large cheap buildings",
       cons="No target people found; lake-zone status not confirmed"),
  dict(key="H",  name="Wanqiao (湾桥)",
       rent=5, people=1, reach=1, rules=2, lodging=2, lease=3, heat_noise=4, distance=5, space=False,
       space_text="Not found: one 12-room courtyard at 50,000 CNY a year, a village house",
       rent_text="No per-m2 rent",
       near="21,130 residents (2020); few newcomer venues",
       pros="Lowest cost per room found",
       cons="Far, by car only"),
  dict(key="M",  name="Haidong and Lixiangbang (海东, 理想邦), east shore",
       rent=2, people=1, reach=1, rules=3, lodging=3, lease=3, heat_noise=3, distance=5, space=True,
       space_text="Found (weak source): one square shop of 100 m2 at 168,000 a year",
       rent_text="140 CNY per m2 a month for one square shop (weak source)",
       near="32,411 residents (2020); resort visitors",
       pros="Resort lodging",
       cons="Across the lake from where long-stayers live"),
  dict(key="N",  name="Shuanglang and Wase (双廊, 挖色), north-east shore",
       rent=1, people=1, reach=1, rules=1, lodging=4, lease=1, heat_noise=3, distance=5, space=True,
       space_text="Found (weak source): a 30 m2 pier shop at 200,000 a year",
       rent_text="556 CNY per m2 a month for a pier shop (weak source)",
       near="17,899 and 16,431 residents (2020); day tourists",
       pros="Tourist lodging",
       cons="Heritage town plus lake zone; only 15 of 628 food and lodging businesses had reopened by mid-2018"),
 ],

 # ---- STEP 0: other cities. urban = urban residents, 2020 census (citypopulation.de, fetched 23 Nov 2026) ----
 # heads_2026 comes from the public project guide (Huizhou only). N = a count nobody has made yet.
 "cities": [
  dict(city="Hefei",     urban=5055978,  heads_2026="N", note="2026 stop with a host room"),
  dict(city="Suzhou",    urban=5892892,  heads_2026="N", note="2026 stop with a host room"),
  dict(city="Chengdu",   urban=13568357, heads_2026="N", note="2026 stop; a partner-location proposal exists in the files, state unknown"),
  dict(city="Xichang",   urban=None,     heads_2026="N", note="2026 stop with a host room; not in the census table read"),
  dict(city="Maoming",   urban=1307802,  heads_2026="N", note="2026 stop with a host room"),
  dict(city="Zhuhai",    urban=2207090,  heads_2026="N", note="2026 stop with a host room"),
  dict(city="Guangzhou", urban=16096724, heads_2026="N", note="2026 stop with a host room"),
  dict(city="Huizhou",   urban=2900113,  heads_2026="43", note="2026 stop with a host room"),
  dict(city="Kunming",   urban=5273144,  heads_2026="no stop", note="No stop yet. Yesterday's report: if Yunnan at all, Kunming first"),
 ],

 # ---- version 1 results, copied from dali-shala-model-output.txt, for the 'what moved' table ----
 "v1": dict(members_base=6.0, small_low=-74575, small_base=21838, small_high=250194,
            medium_base=-22538, large_base=-104867, breakeven_alone=9.5, breakeven_with_events=4.2,
            cash_to_open=137213, aybkk_a=51248, aybkk_b=60395, aybkk_c=50462, per_day_c=3604,
            top_area="B (Xiaoyuanzi strip), 53 of 75"),
}

M = INPUTS["money"]; DM = INPUTS["demand"]; FX = INPUTS["fixed"]; SIZES = INPUTS["sizes"]
MAIN_SIZES = ["small", "medium", "large"]
ALL_SIZES = ["micro", "small", "medium", "large"]

# Used only by the 'what moved since version 1' table and the one-at-a-time table:
# a value put here replaces an input for one run and is then taken out again.
OVERRIDE = {}


def D(name, case):
    return OVERRIDE.get((name, case), DM[name][case])


def F(name):
    return OVERRIDE.get(name, FX[name]["base"])


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
def n0(x):
    return f"{x:,.0f}"


def n1(x):
    return f"{x:,.1f}"


def n2(x):
    return f"{x:,.2f}"


def pct(x):
    return f"{x * 100:.1f}%"


def pct2(x):
    return f"{x * 100:.2f}%"


def thb(cny):
    return cny * M["thb_per_cny"]["base"]


def seat_cny():
    return M["seat_thb"]["base"] / M["thb_per_cny"]["base"]


def seats(cny):
    return cny / seat_cny()


def cohort_day_cny():
    return M["cohort_day_thb"]["base"] / M["thb_per_cny"]["base"]


def table(title, headers, rows):
    print()
    print("### " + title)
    print()
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join(["---"] * len(headers)) + "|")
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")


def note(text):
    print()
    print(text)


# ----------------------------------------------------------------------------
# taxes
# ----------------------------------------------------------------------------
def iit_business(taxable_year, relief=True):
    """Individual business (Chinese owner). Bands 5% to 35%; halved to 31 Dec 2027 (relief=True)."""
    bands = [(30000, 0.05), (90000, 0.10), (300000, 0.20), (500000, 0.30), (float("inf"), 0.35)]
    tax = 0.0
    prev = 0.0
    for top, rate in bands:
        if taxable_year > prev:
            tax += (min(taxable_year, top) - prev) * rate
        prev = top
    return tax * (F("iit_business_halved") if relief else 1.0)


def teaching_fee_tax(fee_in_one_month):
    """Income tax withheld on a teaching fee paid by a Chinese host to a visitor.
    Sum from yesterday's report: fee x 80%, then the monthly table."""
    t = fee_in_one_month * 0.8
    table_ = [(3000, 0.03, 0), (12000, 0.10, 210), (25000, 0.20, 1410), (35000, 0.25, 2660),
              (55000, 0.30, 4410), (80000, 0.35, 7160), (float("inf"), 0.45, 15160)]
    for top, rate, quick in table_:
        if t <= top:
            return max(0.0, t * rate - quick)
    return 0.0


# ----------------------------------------------------------------------------
# STEP 0. WHY DALI FIRST?
# ----------------------------------------------------------------------------
def chain_per_person():
    """Paying daily-practice residents per resident, by the base top-down chain with local factor 1.0."""
    return DM["yoga_rate"]["base"] * 1.0 * DM["daily_traditional_share"]["base"] * DM["pay_share_residents"]["base"]


def step0_cities():
    print()
    print("## STEP 0. WHY DALI FIRST? The same demand chain run on the cities he already teaches in")
    k = chain_per_person()
    note(f"Chain per resident (base shares, local factor 1.0, no long-stayers): {DM['yoga_rate']['base']} x {DM['daily_traditional_share']['base']} x "
         f"{DM['pay_share_residents']['base']} = {k:.8f}, or {n2(k * 1000000)} month payers per 1 million urban residents. "
         "Every share in it is a guess, so read the ORDER of the cities, not the numbers.")
    rows = []
    for c in INPUTS["cities"]:
        pool = n1(c["urban"] * k) if c["urban"] else "N"
        rows.append([c["city"], "N (Carne)", c["heads_2026"], "N (Carne)", n0(c["urban"]) if c["urban"] else "N (Neo)", pool,
                     "0 (a host's room exists)" if "host room" in c["note"] else "N", c["note"]])
    cp = cash_and_payback("small", "base")
    rows.append(["Dali (Dali Town)", "0 known", "no stop", "N (Carne)", n0(F("dali_town_residents")),
                 n1(F("dali_town_residents") * k), n0(cp["cash_to_open"]), "No graduate or host is known there (yesterday's report)"])
    table("0a. One row per city (N = a count nobody has made; the name in brackets can count it)",
          ["City", "Graduates with a running room", "2026 workshop heads", "In-Depth seats sent from that city",
           "Urban residents, 2020 census", "Month payers by the same chain", "Cash to open a room, CNY", "Note"], rows)
    be = break_even("small", "base")
    note(f"People a city needs for the chain to give {n1(be['alone'])} month payers (the small room's break-even on month members alone): "
         f"{n0(be['alone'] / k)}. Dali Town has {n0(F('dali_town_residents'))}. "
         "Dali is not the first city by any count we hold. The model is for Dali because that was the ask. "
         "Urban residents are from citypopulation.de (2020 census, fetched 23 Nov 2026); the private counts are not in any file I may print.")


# ----------------------------------------------------------------------------
# STEP 1. DEMAND
# ----------------------------------------------------------------------------
def longstay_present_city():
    return F("longstay_city_period") * F("longstay_avg_days") / F("longstay_period_days")


def topdown(case):
    res_near = (F("dali_town_residents")
                + D("yinqiao_counted", case) * F("yinqiao_residents")
                + D("xiaguan_reach_share", case) * F("xiaguan_side_residents"))
    long_near = longstay_present_city() * D("longstay_near_share", case)
    rate = D("yoga_rate", case) * D("local_factor", case)
    res_yoga = res_near * rate
    long_yoga = long_near * rate
    res_daily = res_yoga * D("daily_traditional_share", case)
    long_daily = long_yoga * D("daily_traditional_share", case)
    res_pay = res_daily * D("pay_share_residents", case)
    long_pay = long_daily * D("pay_share_longstay", case)
    return dict(res_near=res_near, long_near=long_near, rate=rate, res_yoga=res_yoga, long_yoga=long_yoga,
                res_daily=res_daily, long_daily=long_daily, res_pay=res_pay, long_pay=long_pay,
                pool=res_pay + long_pay)


def bottomup(case):
    return D("existing_room_listed", case) + D("existing_room_courtyard", case) + D("existing_room_third", case)


def season_average():
    nb = F("busy_months")
    return (nb * F("busy_factor") + (12 - nb) * F("quiet_factor")) / 12.0


def new_room_residents(case, yearly_loss=None):
    """Settled members of the new room, each with a named source.
    places = taken from the rooms that exist + newly made + a share of the unserved top-down pool (0 in this model).
    paying = places x (1 - yearly loss x months a place stays empty / 12)."""
    bu = bottomup(case)
    td = topdown(case)["pool"]
    unserved = max(0.0, td - bu)
    taken = D("switch_share", case) * bu
    taken_listed = D("switch_share", case) * D("existing_room_listed", case)
    made = D("new_practitioners", case)
    from_unserved = D("unserved_capture", case) * unserved
    places = taken + made + from_unserved
    base_loss = F("resident_yearly_loss")
    joiners = places * base_loss                      # people who must join each year to hold that level
    loss = base_loss if yearly_loss is None else yearly_loss
    places_at_loss = joiners / loss                   # a lower loss holds more places with the same joiners
    paying = places_at_loss * (1.0 - loss * F("replace_gap_months") / 12.0)
    if "residents_paying" in OVERRIDE:
        paying = OVERRIDE["residents_paying"]
    return dict(bu=bu, td=td, unserved=unserved, taken=taken, taken_listed=taken_listed, made=made,
                from_unserved=from_unserved, places=places, joiners=joiners, paying=paying)


def step1_demand():
    print()
    print("## STEP 1. DEMAND: who would pay by the month for a daily Mysore room in Dali City")

    present = longstay_present_city()
    map_people = F("dali_town_residents") + F("yinqiao_residents") + present * DM["longstay_near_share"]["high"]
    national_density = F("national_yoga_venues") / F("china_population")
    ratio6 = (FX["oldtown_side_studios"]["base"] / map_people) / national_density
    ratio10 = (FX["oldtown_side_studios"]["high"] / map_people) / national_density
    note(f"Long-stayers in Dali City on an average day (ESTIMATE): {n0(F('longstay_city_period'))} x {F('longstay_avg_days')} days / "
         f"{F('longstay_period_days')} days = {n0(present)}.")
    note(f"Local factor (ESTIMATE): the map area holds about {n0(map_people)} people (Dali Town + Yinqiao + 35% of long-stayers). "
         f"China has 1 yoga venue per {n0(1 / national_density)} people. With the {FX['oldtown_side_studios']['base']} real studios the ratio is {n2(ratio6)}; "
         f"with all {FX['oldtown_side_studios']['high']} map entries it is {n2(ratio10)}. Dali rooms hold 2 to 10 people, so a venue count overstates. "
         "The model uses 0.5, 1.0 and 2.0.")

    td = {c: topdown(c) for c in CASES}
    rows = [
        ["Residents near", *[n0(td[c]["res_near"]) for c in CASES], "FACT (2020 census) + guess on who is 'near'"],
        ["Long-stayers near, on an average day", *[n0(td[c]["long_near"]) for c in CASES], "ESTIMATE x guess"],
        ["Share who practise yoga steadily (national rate x local factor)", *[pct2(td[c]["rate"]) for c in CASES], "VENDOR CLAIM x guess"],
        ["= steady yoga people: residents", *[n0(td[c]["res_yoga"]) for c in CASES], ""],
        ["= steady yoga people: long-stayers", *[n0(td[c]["long_yoga"]) for c in CASES], ""],
        ["Share who would do a daily traditional practice", *[pct(D("daily_traditional_share", c)) for c in CASES], "guess"],
        ["Share who would pay about 1,300 a month: residents", *[pct(D("pay_share_residents", c)) for c in CASES], "guess, no source"],
        ["Share who would pay about 1,300 a month: long-stayers", *[pct(D("pay_share_longstay", c)) for c in CASES], "guess, no source"],
        ["= residents who would pay by the month", *[n2(td[c]["res_pay"]) for c in CASES], ""],
        ["= long-stayers who would pay by the month", *[n2(td[c]["long_pay"]) for c in CASES], ""],
        ["**Top-down pool, whole town**", *["**" + n1(td[c]["pool"]) + "**" for c in CASES], "five uncertain shares multiplied"],
    ]
    table("1a. Top-down (people x yoga share x daily-practice share x price share)", ["Line", "Low", "Base", "High", "Kind"], rows)
    note(f"Reading: the top-down chain cannot be checked. High is {n0(td['high']['pool'] / td['low']['pool'])} times low. "
         f"Its base ({n1(td['base']['pool'])}) is too low, because a room has stayed open for five years. "
         "So it shows only how wide the guess is. The bottom-up count is the only anchor.")

    bu = {c: bottomup(c) for c in CASES}
    rows = [
        ["Listed Mysore room (open since Oct 2021; Mysore-only month 1,300)", *[D("existing_room_listed", c) for c in CASES], "guess: class size is not published"],
        ["Lakeside courtyard (week card 600; lives on courses)", *[D("existing_room_courtyard", c) for c in CASES], "guess"],
        ["Third yard (a 'Mysore of ten' in 2022; no trace since May 2024)", *[D("existing_room_third", c) for c in CASES], "guess"],
        ["**Bottom-up pool: month members in the rooms that exist**", *["**" + str(bu[c]) + "**" for c in CASES], ""],
        ["Income this gives the listed room at 1,100 a month average", *[n0(D("existing_room_listed", c) * F("price_resident_month")) for c in CASES], "ESTIMATE, CNY a month"],
        ["Unserved by the sums: top-down pool less bottom-up pool (not below 0)", *[n1(max(0.0, td[c]["pool"] - bu[c])) for c in CASES], "printed, not used"],
    ]
    table("1b. Bottom-up (what the rooms in Dali show)", ["Line", "Low", "Base", "High", "Kind"], rows)
    note("Signs that the town has no spare demand (FACT): three Ashtanga rooms have tried Dali since 2020 and one still shows a daily class in 2026. "
         "That room cut its teaching window from 3 hours (2024) to 1 hour 45 (2026), moved its start from 6:30 to 9:00, cut its week card from 900 to 600 "
         "and its single class from 200 to 150, kept its month price flat for three years, and prints a term of 26 weeks.")
    note("Cross-marks (FACT unless said): visiting Ashtanga events in Dali offered 12 places, limits of 15 and 16, caps of 20 to 25 (offers, not head counts). "
         "One Mysore class elsewhere in China capped year cards at 30 as its room limit (2021). Kunming's one-month course was limited to 6.")

    rows = []
    for c in CASES:
        r = new_room_residents(c)
        listed = D("existing_room_listed", c)
        her_loss = r["taken_listed"] * F("price_resident_month")
        her_income = listed * F("price_resident_month")
        rows.append([c, f"{D('switch_share', c)} x {r['bu']} = {n1(r['taken'])}", n1(r["made"]), n1(r["from_unserved"]),
                     "**" + n1(r["places"]) + "**", n1(r["joiners"]), n2(r["paying"]),
                     f"{n1(r['taken_listed'])} of {listed}", f"{n0(her_loss)} of {n0(her_income)} ({pct(her_loss / her_income)})"])
    table("1c. Settled members of the new room, each with a source (month 25 onward; all guess)",
          ["Case", "Taken from the rooms that exist (switch share x bottom-up pool)", "Newly made month payers", "Won from the unserved pool",
           "Places held", f"New people to find each year (yearly loss {pct(F('resident_yearly_loss'))})",
           f"Paying on average (a place stays empty {F('replace_gap_months')} months)",
           "Taken from the listed teacher", "Her loss a month, CNY (share of her guessed income)"], rows)

    rows = []
    for c in CASES:
        r = new_room_residents(c)
        lng = D("long_stayers", c)
        signups = lng * 12 / F("longstay_months_on_pass")
        flow = td[c]["long_pay"] * 365 / F("longstay_avg_days")
        if signups == 0:
            verdict = "none assumed"
        elif signups / flow > 0.5:
            verdict = f"{n1(signups / flow)} times the town's flow: NOT SUPPORTED by the chain"
        else:
            verdict = f"{n2(signups / flow)} of the town's flow"
        tot = r["paying"] + lng * season_average()
        rows.append([c, n2(r["paying"]), lng, n2(lng * season_average()), "**" + n1(tot) + "**",
                     D("visitor_weeks_per_month", c), D("drop_ins_per_month", c),
                     n0(signups), n1(flow), verdict, pct(tot / r["bu"])])
    table("1d. The three cases the model uses (all guess)",
          ["Case", "Settled members, paying", "Long-stayers on a pass, middle month", "Long-stayers, yearly average", "Month members, yearly average",
           "Week cards, middle month", "Drop-ins, middle month", "Long-stay sign-ups needed a year",
           "Paying long-stay arrivals a year in the whole town (top-down chain)", "Test", "New room as share of the bottom-up pool"], rows)
    note(f"Season: {F('busy_months')} busy months at x {F('busy_factor')} and {12 - F('busy_months')} quiet months at x {F('quiet_factor')} "
         f"give a yearly average of x {n2(season_average())} for long-stayers and visitors. Settled members stay flat.")
    rb = new_room_residents("base")
    note(f"Reading: the base case is {n1(rb['paying'] + D('long_stayers', 'base') * season_average())} month members. Of its {n1(rb['places'])} settled places, "
         f"{n1(rb['taken'])} are taken from a room that exists and {n1(rb['made'])} is a beginner not yet made. "
         "The long-stayer line fails its own test wherever it is used, so it rests on nothing but the guess. "
         "One count would replace most of these guesses: the mats in use in the listed room on a few mornings. Nobody has it. "
         "Yesterday's plan asks that teacher by Sun 29 Nov 2026; her number should replace the 3 / 5 / 10 above.")


# ----------------------------------------------------------------------------
# STEP 2. SIZE
# ----------------------------------------------------------------------------
def members_per_mat(window=None, fill=None):
    window = F("window_hours") if window is None else window
    fill = F("comfort_fill") if fill is None else fill
    turns = window / F("mat_hours")
    return turns / F("attend_share") * fill


def capacity_members(size):
    return math.floor(SIZES[size]["mats"] * members_per_mat())


def floor_m2(size):
    mats = SIZES[size]["mats"]
    practice = mats * F("m2_per_mat")
    total = practice / F("practice_share_of_floor")
    return practice, total


def cheapest_listing(need_m2):
    fits = [l for l in INPUTS["listings"] if l["m2"] >= need_m2]
    return min(fits, key=lambda l: l["rent"])


SPACE_KINDS = {
    "house":   "Whole ground-floor house, the cheapest real listing that is big enough (a home, foothill belt A2)",
    "half":    "The teacher lives in that house and charges the room half the rent (home as business)",
    "bare":    "Bare home room, as the existing room is: the teacher's own home, no rent charged, no hired help, no social insurance, no licence costs",
    "oldtown": "Old Town shop building at the Boai gate, about 200 m2 on 4 floors at 80,000 a year: the only priced unit found that can hold a licence",
    "shop53":  "A ground-floor shop unit of the exact size at 48.1 per m2 in the foothill belt (version 1's space; NONE FOUND)",
    "b324":    "Area B's only priced listing: a 324 m2 villa at 13,000 a month (a home; Dec 2024, old)",
    "partner": "Mornings inside a partner's licensed studio: no rent, no fit-out; the studio keeps a share of daily sales (example 40%)",
}


def space(size, kind):
    """The space the room sits in, and which cost lines it carries."""
    practice, total = floor_m2(size)
    li = cheapest_listing(total)
    s = dict(kind=kind, rent=float(li["rent"]), listing=li, lease_years=F("lease_years_home"),
             papers=F("papers_home_cny"), fitout=total * F("fitout_per_m2"), heating_kit=practice * F("heating_kit_per_m2"),
             lease_costs=True,     # deposit, rent paid a year ahead, rent during fit-out, agent fee
             running=True,         # property fee, water, light, internet, heating power
             hired_help=True, marketing=True, owner_si=True, books=True, pay_in_reserve=True, studio_share=0.0)
    if kind == "half":
        s["rent"] = li["rent"] * 0.5
    elif kind == "bare":
        s.update(rent=0.0, fitout=F("bare_room_fitout"), heating_kit=0.0, papers=0.0, lease_costs=False,
                 hired_help=False, marketing=False, owner_si=False, books=False, pay_in_reserve=False)
    elif kind == "oldtown":
        s.update(rent=F("oldtown_building_rent"), lease_years=F("lease_years_shop"), papers=F("papers_shop_cny"))
    elif kind == "shop53":
        s.update(rent=total * F("shop_unit_rent_per_m2"), lease_years=F("lease_years_shop"), papers=F("papers_shop_cny"))
    elif kind == "b324":
        s.update(rent=F("b_listing_rent"))
    elif kind == "partner":
        s.update(rent=0.0, fitout=0.0, heating_kit=0.0, papers=0.0, lease_costs=False, running=False,
                 hired_help=False, studio_share=F("example_studio_share"))
    return s


def setup_cost(size, kind="house", owner="graduate"):
    sp = space(size, kind)
    mats = SIZES[size]["mats"]
    fitout = sp["fitout"]
    props = mats * F("props_per_mat")
    kit = sp["heating_kit"]
    papers = sp["papers"] + (F("papers_wfoe_cny") if owner == "wfoe" else 0.0)
    opening = F("opening_marketing") if sp["marketing"] else 0.0
    before_open = sp["rent"] * F("prelaunch_rent_months") if sp["lease_costs"] else 0.0
    agent = sp["rent"] * F("agent_fee_months") if sp["lease_costs"] else 0.0
    total = fitout + props + kit + papers + opening + before_open + agent
    restore = fitout * F("restore_share")
    return dict(fitout=fitout, props=props, heating=kit, papers=papers, opening=opening, before_open=before_open,
                agent=agent, total=total, restore=restore)


def rent_rise_average(years):
    """Average rent over the lease when it rises each year: mean of (1 + rise)^0 .. (1 + rise)^(years-1)."""
    years = max(1, int(round(years)))
    return sum((1 + F("rent_rise_year")) ** k for k in range(years)) / years


def step2_size():
    print()
    print("## STEP 2. SIZE: three rooms, and one smaller")
    note(f"Members one mat place supports: window {F('window_hours')} h / {F('mat_hours')} h on the mat = {n2(F('window_hours') / F('mat_hours'))} turns; "
         f"/ {F('attend_share')} (a member comes 5 days of 6) x {F('comfort_fill')} (do not sell the last places) = {n2(members_per_mat())} members per mat. "
         f"Range: {n2(members_per_mat(2.0))} with a 2-hour window to {n2(members_per_mat(3.0, 1.0))} with a 3-hour window sold full.")
    demand = {c: new_room_residents(c)["paying"] + D("long_stayers", c) * season_average() for c in CASES}
    rows = []
    for s in ALL_SIZES:
        z = SIZES[s]
        practice, total = floor_m2(s)
        cap = capacity_members(s)
        cap_low = math.floor(z["mats_low"] * members_per_mat(2.0))
        cap_high = math.floor(z["mats_high"] * members_per_mat(3.0, 1.0))
        li = cheapest_listing(total)
        rows.append([s, f"{z['mats']} ({z['mats_low']} to {z['mats_high']})",
                     f"{n0(practice)} ({n0(z['mats_low'] * FX['m2_per_mat']['low'])} to {n0(z['mats_high'] * FX['m2_per_mat']['high'])})",
                     n0(total), f"{cap} ({cap_low} to {cap_high})",
                     n1(cap / demand["base"]), n1(cap / demand["high"]),
                     f"{li['m2']} m2 at {n0(li['rent'])}", n1(li["rent"] / li["m2"]), n1(li["rent"] / total)])
    table("2a. Floor, members and the real space each size would have to rent",
          ["Size", "Mats (range)", "Practice room m2 at 3.0 m2 a mat (range at 2.5 to 3.0)",
           "Total m2 with entrance, changing space, toilet (practice / 0.57)", "Month members it can serve (range)",
           "Times the base-case members", "Times the high-case members",
           "Cheapest real listing that is big enough, CNY a month", "Rent per m2 of that listing", "Rent per m2 the room uses"], rows)
    note("Space per mat: 2.5 to 3 m2 for dynamic yoga, Ashtanga named (bsport, vendor); 27 sq ft = 2.5 m2 (Virtuagym, vendor). "
         "Practice room = 57% of the floor (Mysore House Madrid, 170 of 300 m2; one shala).")
    rows = []
    for l in INPUTS["listings"]:
        rows.append([l["m2"], n0(l["rent"]), n1(l["rent"] / l["m2"]), l["where"], l["src"]])
    table("2b. The five real whole spaces found in the foothill estates (asking rents; no small ground-floor unit was found)",
          ["m2", "Rent a month, CNY", "CNY per m2", "Where and what", "Source"], rows)
    note("None of these adverts shows one open room of the size a medium or large shala needs, and a wall may not be taken down in a rented home. "
         "The small flats in these estates (54 to 55 m2 at 45.5 to 55.7 per m2) are on a middle floor with neighbours below.")

    rows = []
    for s in ALL_SIZES:
        c = setup_cost(s)
        sp = space(s, "house")
        deposit = sp["rent"] * F("deposit_months")
        advance = sp["rent"] * F("advance_rent_months")
        _, total = floor_m2(s)
        rows.append([s, n0(c["fitout"]), n0(c["props"]), n0(c["heating"]), n0(c["papers"]), n0(c["opening"]),
                     n0(c["before_open"]), n0(c["agent"]), "**" + n0(c["total"]) + "**", n0(c["total"] / total),
                     n0(deposit), n0(advance), n0(c["restore"])])
    table("2c. Set-up cost in a rented house, CNY (fit-out 800 per m2 is a guess between a 500 template and 1,500 from old founder claims)",
          ["Size", "Fit-out", "Props", "Heating kit", "Papers (Chinese owner, home address)", "Opening week",
           "Rent during the fit-out (1.5 months)", "Agent fee (1 month)", "Set-up cost", "Set-up per m2 used",
           "Deposit (1 month, comes back)", "Rent paid up front (12 months)", "Cost at the end to hand the house back (10% of fit-out)"], rows)
    rows = []
    for s in ALL_SIZES:
        _, total = floor_m2(s)
        mats = SIZES[s]["mats"]
        practice, _ = floor_m2(s)
        rent = space(s, "house")["rent"]
        lo = (total * FX["fitout_per_m2"]["low"] + mats * FX["props_per_mat"]["low"] + practice * FX["heating_kit_per_m2"]["low"]
              + FX["papers_home_cny"]["low"] + FX["opening_marketing"]["low"] + rent * (FX["prelaunch_rent_months"]["low"] + FX["agent_fee_months"]["low"]))
        hi = (total * FX["fitout_per_m2"]["high"] + mats * FX["props_per_mat"]["high"] + practice * FX["heating_kit_per_m2"]["high"]
              + FX["papers_home_cny"]["high"] + FX["opening_marketing"]["high"] + rent * (FX["prelaunch_rent_months"]["high"] + FX["agent_fee_months"]["high"]))
        rows.append([s, n0(lo), n0(setup_cost(s)["total"]), n0(hi)])
    table("2d. Set-up cost range if every guess is low or every guess is high, CNY", ["Size", "All low", "Model", "All high"], rows)


# ----------------------------------------------------------------------------
# STEP 3. AREA
# ----------------------------------------------------------------------------
def area_scores(with_distance=True):
    w = dict(INPUTS["area_weights"])
    if not with_distance:
        w["distance"] = 0
    g = INPUTS["area_gates"]
    out = []
    for a in INPUTS["areas"]:
        score = sum(a[k] * w[k] for k in w)
        failed = [k for k in g if a[k] < g[k]]
        if failed:
            tier = 2                      # wrong people or barred by rules
        elif not a["space"]:
            tier = 1                      # right people, but no space that can hold a licence at a known rent
        else:
            tier = 0
        out.append(dict(a, score=score, failed=failed, tier=tier))
    out.sort(key=lambda x: (x["tier"], -x["score"], -x["distance"]))
    for i, a in enumerate(out):
        a["rank"] = i + 1
    return out


def step3_area():
    print()
    print("## STEP 3. AREA: every candidate area scored 1 (worst) to 5 (best)")
    w = INPUTS["area_weights"]; g = INPUTS["area_gates"]
    note("Weights: " + ", ".join(f"{k} x{w[k]}" for k in w) + f". Top score possible: {5 * sum(w.values())}. "
         "Hard gates: at least " + ", ".join(f"{g[k]} on {k}" for k in g) + ", and a space that can hold a business licence at a known rent. "
         "Order: areas that pass every gate, then areas with the right people but no proven space, then the rest.")
    note("What the columns mean. people: target people who live or stay close. reach: getting there at 6 am. rules: heritage, lake zone, fire, home-as-business. "
         "lease: lease risk. distance: how far from the existing Mysore room and other Ashtanga classes (5 = far). rent: 5 = cheap. lodging: rooms near for visitors. heat_noise: heating and noise.")
    welcome_text = {None: "NOT ASKED", True: "YES", False: "NO"}[WELCOME]
    note(f"The welcome gate. Has the teacher of the existing Mysore room said a second room is welcome? {welcome_text}. "
         "Every area on the Old Town side draws on her small base, so this gate sits above the table: until she has been asked and says yes, the answer for every area is 'no'. "
         "Kilometres do not settle it. Yesterday's plan asks her by Sun 29 Nov 2026.")
    sc = area_scores(True)
    tier_text = {0: "passes every gate", 1: "right people; space NOT PROVEN", 2: "FAILS "}
    rows = []
    for a in sc:
        gate = tier_text[a["tier"]] + (", ".join(a["failed"]) if a["tier"] == 2 else "")
        rows.append([a["rank"], a["key"], a["name"], a["people"], a["reach"], a["rules"], a["lease"], a["distance"],
                     a["rent"], a["lodging"], a["heat_noise"], a["score"], "found" if a["space"] else "not found", gate])
    table("3a. Scores and rank", ["Rank", "Key", "Area", "people", "reach", "rules", "lease", "distance", "rent", "lodging", "heat_noise",
                                  "Score", "Space that can hold a licence, at a known rent", "Gates"], rows)
    rows = []
    for a in sc:
        rows.append([a["rank"], a["key"], a["rent_text"], a["space_text"], a["near"], a["pros"], a["cons"]])
    table("3b. Rent, space, who is near, for and against", ["Rank", "Key", "Rent seen (asking prices)", "Space that can hold a licence", "Who is near", "For", "Against"], rows)

    yes = [a for a in area_scores(False) if a["tier"] < 2]
    yes.sort(key=lambda x: -x["score"])
    rows = [[i + 1, a["key"], a["name"], a["score"], "found" if a["space"] else "not found"] for i, a in enumerate(yes)]
    table("3c. If she says yes: the same scores with the distance column left out (areas with the right people only)",
          ["Rank", "Key", "Area", "Score without distance", "Space that can hold a licence"], rows)
    by_key = {a["key"]: a for a in sc}
    right_people = [a for a in sc if a["tier"] < 2]
    note(f"Reading. No area is proven. Only one area with the right people has a space that can hold a licence at a known rent: C, the Old Town inside the walls "
         f"(score {by_key['C']['score']} of {5 * sum(w.values())}, the lowest of the {len(right_people)} areas with the right people). "
         f"The areas that score best on people (A2 {by_key['A2']['score']}, E {by_key['E']['score']}, A1 {by_key['A1']['score']}, D {by_key['D']['score']}, B {by_key['B']['score']}) "
         "offer homes, village houses or a site with no stated rent. Xiaguan (K) has the shop units and not the people. "
         f"Version 1's pick, B, falls to {by_key['B']['score']}: its only priced space is a villa at 13,000 a month, it has its own Ashtanga classes, and the home-as-business rule applies.")
    note("First step for any area, before a score matters: one written rent and the property certificate for one shop unit. "
         "Start with the lane 大理的小巷子 in Xiaoyuanzi phase 5 (a listed studio sits on a second floor there), the Bedsheet Factory operator, "
         "and the 270 m2 space at the Shanshuijian east gate. Asking is a message to a landlord, so it needs Boonchu's go.")
    return sc


# ----------------------------------------------------------------------------
# WORKSHOPS (one function; used by steps 4, 5 and 6)
# ----------------------------------------------------------------------------
def workshop(case, mats=None, price_mult=1.0, heads_mult=1.0, heads=None, vat_share=None):
    """One 5-day workshop by a visiting teacher. mats = the room's mat places (None = a hall, no limit).
    The split is the published 70/30 EXAMPLE, not AYBKK's terms."""
    wanted = D("workshop_heads_wanted", case) if heads is None else heads
    h = min(wanted, mats) if mats is not None else wanted
    h = h * heads_mult                       # the room limit first, then any stress cut
    price = D("workshop_price", case) * price_mult
    gross = h * price
    host_keep = gross * F("workshop_host_share")
    host_gain = host_keep - F("ws_host_cost")
    fee = gross * F("example_teacher_share")
    tax = teaching_fee_tax(fee)
    vat = fee * (F("vat_rate") if vat_share is None else vat_share)
    net = fee - tax - vat
    return dict(n=D("workshops_per_year", case), wanted=wanted, heads=h, price=price, gross=gross,
                host_keep=host_keep, host_gain=host_gain, fee=fee, tax=tax, vat=vat, net=net,
                per_day=net / F("workshop_trip_days"))


# ----------------------------------------------------------------------------
# STEP 4. INCOME
# ----------------------------------------------------------------------------
def pnl(size, case, kind="house", owner="graduate", with_ws=False, relief=True,
        price_mult=1.0, heads_mult=1.0, rent_mult=1.0, full_room=False, yearly_loss=None, royalty=0.0):
    """One year at steady state (month 25 onward). owner = 'graduate' (Chinese citizen, individual business,
    teaches the room and draws teacher_pay) or 'wfoe' (a foreign-owned company that hires a teacher)."""
    z = SIZES[size]
    mats = z["mats"]
    cap = capacity_members(size)
    practice, total = floor_m2(size)
    sp = space(size, kind)
    st = setup_cost(size, kind, owner)

    # heads
    n_res = new_room_residents(case, yearly_loss)["paying"] * heads_mult
    n_long = D("long_stayers", case) * heads_mult
    weeks = D("visitor_weeks_per_month", case) * heads_mult
    drops = D("drop_ins_per_month", case) * heads_mult

    # prices
    p_res = F("price_resident_month") * price_mult
    p_list = F("price_month_list") * price_mult
    p_week = F("price_week") * price_mult
    p_drop = F("price_drop_in") * price_mult

    def one_month(season_factor):
        res = min(n_res, cap)
        lng = min(n_long * season_factor, cap - res)
        if full_room:
            res = cap * 0.7
            lng = cap * 0.3
        members_income = res * p_res + lng * p_list
        visitors_income = weeks * season_factor * p_week + drops * season_factor * p_drop
        return res + lng, members_income, visitors_income

    busy = one_month(F("busy_factor"))
    quiet = one_month(F("quiet_factor"))
    nb = F("busy_months"); nq = 12 - nb
    open_share = F("open_weeks") / 52.0

    members_year = (nb * busy[1] + nq * quiet[1]) * open_share
    visitors_year = (nb * busy[2] + nq * quiet[2]) * open_share
    avg_members = (nb * busy[0] + nq * quiet[0]) / 12.0
    refunds_year = (members_year + visitors_year) * F("refund_share")
    hire_year = D("room_hire_per_year", case)
    course_year = F("course_income_year")                 # 0 in the model; a what-if row sets it
    daily_sales = members_year + visitors_year - refunds_year
    studio_cut_year = daily_sales * sp["studio_share"]    # only when the room sits inside a partner's studio
    royalty_year = (daily_sales + hire_year + course_year) * royalty   # only in the licence example

    # workshops held in the room (only when with_ws is True)
    ws = workshop(case, mats, price_mult, heads_mult)
    ws_keep_year = ws["n"] * ws["host_keep"] if with_ws else 0.0
    ws_cost_year = ws["n"] * F("ws_host_cost") if with_ws else 0.0
    ws_gross_year = ws["n"] * ws["gross"] if with_ws else 0.0

    income_year = daily_sales + hire_year + course_year + ws_keep_year

    # staff
    daily_students = avg_members * F("attend_share") + (weeks / 4.33) + (drops / F("practice_days_per_month"))
    assistants = max(0, math.ceil(daily_students / F("students_per_teacher")) - 1)

    # running costs per month
    rent = sp["rent"] * rent_mult * rent_rise_average(sp["lease_years"])
    prop_fee = total * F("property_fee_per_m2") if (sp["running"] and sp["rent"] > 0) else 0.0
    utilities = total * F("utilities_per_m2") if sp["running"] else 0.0
    heating = (practice * F("heat_kw_per_m2") * F("heat_hours_per_day") * F("practice_days_per_month")
               * F("kwh_price") * F("heat_months") / 12.0) if sp["running"] else 0.0
    if owner == "wfoe":
        pay_month = F("hired_teacher_pay")
        teacher_si = F("si_rate") * max(pay_month, F("si_base_floor"))
        books = F("bookkeeping_company_month") + F("wfoe_audit_year") / 12.0
    else:
        pay_month = F("teacher_pay")
        teacher_si = F("owner_si_month") if sp["owner_si"] else 0.0
        books = F("bookkeeping_month") if sp["books"] else 0.0
    assistant_cost = assistants * (F("assistant_pay") + F("si_rate") * max(F("assistant_pay"), F("si_base_floor")))
    helper = z["helper_hours"] * F("hourly_wage") if sp["hired_help"] else 0.0
    cleaning = z["cleaning_hours"] * F("hourly_wage") if sp["hired_help"] else 0.0
    marketing = F("marketing_month") if sp["marketing"] else 0.0
    insurance = F("insurance_year") / 12.0 if sp["books"] else 0.0
    wear = (st["total"] + st["restore"]) / (sp["lease_years"] * 12.0)

    takings_year = daily_sales + hire_year + course_year + ws_gross_year
    pay_fee_year = takings_year * F("payment_fee")

    # VAT: only a month that reaches 100,000 CNY of sales pays it (on the whole month)
    biggest_month_sales = busy[1] + busy[2] + (ws["gross"] if with_ws else 0.0)
    vat_rate = F("vat_rate") if relief else F("vat_rate_after_2027")
    vat_year = biggest_month_sales * vat_rate * max(1, ws["n"]) if biggest_month_sales >= F("vat_threshold_month") else 0.0

    fixed_no_pay = (rent + prop_fee + utilities + heating + teacher_si + assistant_cost + helper + cleaning
                    + marketing + insurance + books + wear)
    surplus_before_pay = (income_year - studio_cut_year - royalty_year - ws_cost_year
                          - fixed_no_pay * 12 - pay_fee_year - vat_year)
    if owner == "graduate":
        taxable = max(0.0, surplus_before_pay - F("iit_allowance"))
        income_tax_year = iit_business(taxable, relief)
    else:
        income_tax_year = 0.0     # a company: its tax is worked out in wfoe_result()
    profit_year = surplus_before_pay - income_tax_year - pay_month * 12

    month_costs = fixed_no_pay + pay_month + (pay_fee_year + vat_year + income_tax_year) / 12.0
    keep = (1 - F("refund_share")) * (1 - sp["studio_share"])

    return dict(
        size=size, case=case, kind=kind, owner=owner, space=sp, setup=st, cap=cap, mats=mats, total_m2=total,
        avg_members=avg_members, busy_members=busy[0], quiet_members=quiet[0],
        members_year=members_year, visitors_year=visitors_year, refunds_year=refunds_year, hire_year=hire_year,
        course_year=course_year, daily_sales=daily_sales, studio_cut_year=studio_cut_year, royalty_year=royalty_year,
        ws=ws, ws_keep_year=ws_keep_year, ws_cost_year=ws_cost_year, ws_gross_year=ws_gross_year,
        income_year=income_year, takings_year=takings_year,
        rent=rent, prop_fee=prop_fee, utilities=utilities, heating=heating, pay_month=pay_month, teacher_si=teacher_si,
        assistants=assistants, assistant_cost=assistant_cost, helper=helper, cleaning=cleaning, marketing=marketing,
        insurance=insurance, books=books, wear=wear, pay_fee_year=pay_fee_year, vat_year=vat_year,
        income_tax_year=income_tax_year, fixed_no_pay=fixed_no_pay, month_costs=month_costs,
        costs_year=(fixed_no_pay + pay_month) * 12 + pay_fee_year + vat_year + income_tax_year + studio_cut_year + royalty_year + ws_cost_year,
        surplus_before_pay=surplus_before_pay, profit_year=profit_year, take_year=profit_year + pay_month * 12,
        quiet_month_result=(quiet[1] + quiet[2]) * keep - month_costs,
        busy_month_result=(busy[1] + busy[2]) * keep - month_costs,
        open_share=open_share,
    )


def break_even(size, case, kind="house", owner="graduate"):
    """Month members needed for a result of zero (income tax left out; it is zero near break-even)."""
    p = pnl(size, case, kind, owner)
    res = new_room_residents(case)["paying"]
    lng = D("long_stayers", case) * season_average()
    if res + lng > 0:
        avg_price = (res * F("price_resident_month") + lng * F("price_month_list")) / (res + lng)
    else:
        avg_price = F("price_resident_month")
    keep = (1 - F("refund_share")) * (1 - F("payment_fee")) * (1 - p["space"]["studio_share"])
    per_member_year = avg_price * 12 * p["open_share"] * keep
    fixed_year = (p["fixed_no_pay"] + p["pay_month"]) * 12
    visitors_net = p["visitors_year"] * keep + p["hire_year"]
    return dict(alone=fixed_year / per_member_year,
                with_visitors=max(0.0, (fixed_year - visitors_net) / per_member_year),
                no_pay=p["fixed_no_pay"] * 12 / per_member_year,
                avg_price=avg_price, per_member_year=per_member_year, fixed_year=fixed_year)


def rent_block(rent0, m_start, months, horizon):
    """Rent paid in one go for the months m_start .. m_start + months - 1; it rises once a year."""
    total = 0.0
    for k in range(m_start, min(m_start + months, horizon + 1)):
        total += rent0 * (1 + F("rent_rise_year")) ** ((k - 1) // 12)
    return total


def cash_and_payback(size, case, kind="house", owner="graduate", with_ws=False, advance=None, horizon=60):
    p = pnl(size, case, kind, owner, with_ws)
    sp = p["space"]; st = p["setup"]
    advance = int(F("advance_rent_months") if advance is None else advance)
    rent0 = sp["rent"]
    deposit = rent0 * F("deposit_months") if sp["lease_costs"] else 0.0
    first_block = rent_block(rent0, 1, advance, horizon) if sp["lease_costs"] else 0.0
    other_month = p["fixed_no_pay"] - p["wear"] - p["rent"] + (p["pay_month"] if sp["pay_in_reserve"] else 0.0)
    reserve = other_month * F("reserve_months")
    cash_to_open = st["total"] + deposit + first_block + reserve

    ramp = F("ramp_months")
    cum = -(st["total"] + deposit)
    deepest = cum
    payback = None
    at24 = None
    year1_income = 0.0
    for m in range(1, horizon + 1):
        if sp["lease_costs"] and (m - 1) % advance == 0:
            cum -= rent_block(rent0, m, advance, horizon)
        r = min(1.0, m / ramp)
        income_m = (p["income_year"] - p["studio_cut_year"] - p["royalty_year"]) / 12.0 * r
        variable_m = (p["pay_fee_year"] + p["vat_year"] + p["income_tax_year"] + p["ws_cost_year"]) / 12.0 * r
        cum += income_m - variable_m - other_month
        if m <= 12:
            year1_income += income_m
        deepest = min(deepest, cum)
        if payback is None and cum >= 0:
            payback = m
        if m == 24:
            at24 = cum
    year1_cost = st["total"] + first_block + other_month * 12
    return dict(deposit=deposit, first_block=first_block, reserve=reserve, cash_to_open=cash_to_open,
                payback=payback, deepest=-deepest, end_cash=cum, at24=at24, horizon=horizon,
                year1_income=year1_income, year1_cost=year1_cost, other_month=other_month)


def run_with(changes, fn):
    """Put some inputs in for one run, then take them out again."""
    OVERRIDE.update(changes)
    try:
        return fn()
    finally:
        for k in changes:
            OVERRIDE.pop(k, None)


def step4_income():
    print()
    print("## STEP 4. INCOME: each size x each demand case, in the cheapest real space near the target people. CNY.")
    note("The teacher is taken to be the owner, a Chinese citizen with an individual business (the lightest route). "
         f"The owner's pay of {n0(F('teacher_pay'))} a month is counted as a cost. 'Result' is what is left after that pay and after tax; "
         "'the owner's take' is pay plus result. The room is judged ALONE first: month members, week cards, drop-ins, room hire. "
         "A visiting teacher's workshop is a separate line (4e), because it is his days, not the room's. No month-long course is counted (4k).")

    results = {(s, c): pnl(s, c) for s in ALL_SIZES for c in CASES}

    rows = []
    for s in ALL_SIZES:
        for c in CASES:
            p = results[(s, c)]
            rows.append([s, c, n1(p["avg_members"]), p["cap"], n0(p["members_year"] / 12), n0(p["visitors_year"] / 12),
                         n0(-p["refunds_year"] / 12), n0(p["hire_year"] / 12),
                         "**" + n0(p["income_year"] / 12) + "**", n0(p["income_year"]), n0(thb(p["income_year"]))])
    table(f"4a. Income by line, the room alone (yearly average a month; open {F('open_weeks')} weeks)",
          ["Size", "Demand", "Month members (average)", "Room can serve", "Month members", "Week cards and drop-ins",
           "Refunds (3%)", "Room hire", "Income a month", "Income a year", "Income a year, THB"], rows)

    rows = []
    for s in ALL_SIZES:
        for c in CASES:
            p = results[(s, c)]
            staff = p["helper"] + p["assistant_cost"]
            tax = (p["vat_year"] + p["income_tax_year"]) / 12
            rows.append([s, c, n0(p["rent"] + p["prop_fee"]), n0(p["utilities"] + p["heating"]), n0(p["pay_month"]), n0(p["teacher_si"]),
                         n0(staff), n0(p["cleaning"]), n0(p["marketing"]), n0(p["pay_fee_year"] / 12), n0(tax),
                         n0(p["wear"]), n0(p["insurance"] + p["books"]), "**" + n0(p["costs_year"] / 12) + "**"])
    table("4b. Cost a month by line (a rented house on a 2-year home lease; rent rises 5% a year)",
          ["Size", "Demand", "Rent and property fee", "Power, heating, water, internet", "The owner-teacher's pay", "The owner's own social insurance",
           "Helper and assistant", "Cleaning", "Marketing", "Payment fees", "Tax (income tax + VAT)",
           "Wear of the set-up over the 2-year lease", "Insurance and bookkeeping", "Cost a month"], rows)

    rows = []
    for s in ALL_SIZES:
        be = break_even(s, "base")
        for c in CASES:
            p = results[(s, c)]
            cp = cash_and_payback(s, c)
            payback = (str(cp["payback"]) if cp["payback"] is not None else f"not within {cp['horizon']} months")
            rows.append([s, c, "**" + n0(p["profit_year"] / 12) + "**", "**" + n0(p["profit_year"]) + "**", n0(thb(p["profit_year"])),
                         n2(seats(p["profit_year"])), n0(p["take_year"] / 12),
                         n1(be["alone"]), n1(be["no_pay"]), p["cap"],
                         n0(cp["cash_to_open"]), n0(-cp["at24"]), n0(-cp["end_cash"]), payback])
    table("4c. Result, break-even, cash and pay-back, the room alone",
          ["Size", "Demand", "Result a month", "Result a year", "Result a year, THB", "In 180K seats",
           "The owner-teacher's take a month (pay + result)",
           "Break-even: month members needed, on month members alone", "Month members needed to cover costs with NO pay at all",
           "Room can serve", "Cash needed to open", "Cash put in by month 24, when the first lease ends (the owner's pay included)",
           "Cash put in by month 60 if it kept going", "Months to earn it back"], rows)
    be = break_even("small", "base")
    note(f"Break-even sum, small room: fixed cost a year {n0(be['fixed_year'])} / (average price {n0(be['avg_price'])} x 12 x {F('open_weeks')}/52 x 97% after refunds x 99.4% after payment fees = "
         f"{n0(be['per_member_year'])} a member a year) = {n1(be['alone'])} month members. The room can serve {capacity_members('small')}. "
         f"The listed room, open five years, is guessed at {DM['existing_room_listed']['base']} ({DM['existing_room_listed']['low']} to {DM['existing_room_listed']['high']}). "
         f"With week cards and drop-ins as in the base case the break-even is {n1(be['with_visitors'])}.")
    cp = cash_and_payback("small", "base")
    note(f"Cash needed to open, small room = set-up {n0(pnl('small', 'base')['setup']['total'])} + deposit {n0(cp['deposit'])} + {F('advance_rent_months')} months of rent up front {n0(cp['first_block'])} "
         f"+ {F('reserve_months')} months of other running cost {n0(cp['reserve'])} = {n0(cp['cash_to_open'])} CNY ({n0(thb(cp['cash_to_open']))} THB, {n1(seats(cp['cash_to_open']))} seats). "
         f"Cash path: it starts at minus (set-up + deposit); rent is paid a year ahead in months 1, 13, 25, 37 and 49 and rises 5% a year; members build up in a straight line over {F('ramp_months')} months. "
         f"Year 1 in words (base): the room takes in {n0(cp['year1_income'])} and pays out {n0(cp['year1_cost'])}, the owner's pay of {n0(F('teacher_pay') * 12)} included. "
         f"At month 24, when the home lease ends, the owner has put in {n0(-cp['at24'])}, of which {n0(F('teacher_pay') * 24)} is the owner's own pay.")
    cp2 = cash_and_payback("small", "base", advance=24)
    note(f"If the owner asks for two years of rent up front (two adverts do): cash needed to open {n0(cp2['cash_to_open'])}.")

    # seasons
    rows = []
    for c in CASES:
        p = results[("small", c)]
        w = p["ws"]
        rows.append([c, n1(p["quiet_members"]), n1(p["busy_members"]), n0(p["quiet_month_result"]), n0(p["busy_month_result"]),
                     n0(w["host_gain"]), n0(p["busy_month_result"] + w["host_gain"]),
                     f"{12 - F('busy_months')} quiet, {F('busy_months')} busy"])
    table("4d. Quiet season and busy season, small room, a month when the room is open all month, no event money spread in (guess)",
          ["Demand", "Month members, quiet month", "Month members, busy month", "Result, quiet month", "Result, busy month",
           "What one hosted workshop adds for the host (30% share less the host's cost)", "Result, a busy month with a workshop", "Months"], rows)

    # workshops as a separate line
    rows = []
    for c in CASES:
        p = results[("small", c)]
        w = p["ws"]
        pw = pnl("small", c, with_ws=True)
        heads_even = F("ws_host_cost") / (w["price"] * F("workshop_host_share"))
        rows.append([c, w["n"], n0(w["wanted"]), n0(w["heads"]), n0(w["price"]), n0(w["gross"]), n0(w["host_keep"]), n0(F("ws_host_cost")),
                     n0(w["host_gain"]), n1(heads_even), n0(p["profit_year"]), n0(pw["profit_year"]), n0(pw["profit_year"] - p["profit_year"])])
    table("4e. A visiting teacher's workshop held in the small room: what it does for the room's owner (EXAMPLE split 70/30; the host pays travel, lodging, meals, translator)",
          ["Demand", "Workshops a year", "Students who would pay", "Students the room holds (10 mats)", "Price", "Gross per workshop",
           "Host keeps 30%", "Host's cost per workshop (guess)", "Host's gain per workshop", "Heads the host needs to cover the cost",
           "Room's result a year without workshops", "With workshops", "Difference a year"], rows)
    note("Reading: at the base head count the host does not earn from the workshop. So a workshop does not rescue the room; it only moves cost onto the host. "
         "The workshop students and the month members also use the same mats on the same mornings; the base 7 includes the room's own members.")

    # which space
    rows = []
    for kind in ["house", "half", "bare", "oldtown", "shop53", "b324", "partner"]:
        row = [SPACE_KINDS[kind]]
        sp = space("small", kind)
        row.append(n0(sp["rent"]))
        row.append(sp["lease_years"])
        for c in CASES:
            p = pnl("small", c, kind)
            row.append(n0(p["profit_year"]))
        pb = pnl("small", "base", kind)
        row.append(n0(pb["take_year"] / 12))
        row.append(n0(pnl("small", "high", kind)["take_year"] / 12))
        row.append(n1(break_even("small", "base", kind)["alone"]))
        row.append(n0(cash_and_payback("small", "base", kind)["cash_to_open"]))
        rows.append(row)
    table("4f. Which space: the small room (10 mats) in seven kinds of space, a year, the room alone",
          ["Space", "Rent a month, year 1", "Lease years used", "Result, low", "Result, base", "Result, high",
           "Owner's take a month, base", "Owner's take a month, high", "Break-even month members (pay counted)", "Cash needed to open"], rows)
    rows = []
    for s in ["micro", "small"]:
        for c in CASES:
            p = pnl(s, c, "bare")
            rows.append([s, c, n1(p["avg_members"]), n0(p["income_year"]), n0(p["income_year"] - p["take_year"]),
                         "**" + n0(p["take_year"]) + "**", "**" + n0(p["take_year"] / 12) + "**", n0(thb(p["take_year"] / 12)),
                         n2(seats(p["take_year"])), n0(cash_and_payback(s, c, "bare")["cash_to_open"])])
    table("4g. The bare home room (the form the existing room has): what the teacher keeps, with no fixed pay counted",
          ["Size", "Demand", "Month members (average)", "Income a year", "Costs and tax a year", "The teacher keeps, a year",
           "The teacher keeps, a month", "A month, THB", "A year, in 180K seats", "Cash needed to open"], rows)
    bb = break_even("micro", "base", "bare")
    need_min = (bb["no_pay"] * bb["per_member_year"] + F("min_wage_month") * 12) / bb["per_member_year"]
    note(f"Month members a bare home room of 6 mats needs: {n1(bb['no_pay'])} to cover its costs, {n1(need_min)} for the teacher to keep the minimum wage "
         f"({n0(F('min_wage_month'))} a month), {n1(bb['alone'])} for the teacher to keep {n0(F('teacher_pay'))} a month. It can serve {capacity_members('micro')}. "
         f"The base case is {n1(pnl('micro', 'base', 'bare')['avg_members'])}; the high case is {n1(pnl('micro', 'high', 'bare')['avg_members'])}.")
    note(f"For scale: the legal minimum wage in Dali City is {n0(F('min_wage_month'))} CNY a month. "
         "A bare home room has no business address that is sure to hold a licence, cannot do the pre-opening fire step, and needs the consent of the affected neighbours. "
         "It cannot be used by a foreign-owned company, and AYBKK's name should not sit on it.")
    rows = []
    hours_month = F("window_hours") * F("practice_days_per_month")
    for c in CASES:
        p = results[("micro", c)]
        open_hours_year = hours_month * 12 * p["open_share"]
        rows.append([c, n0(p["income_year"]), n0(open_hours_year), n0(p["income_year"] / open_hours_year)])
    table("4h. Hired hours in a studio that is already there: rent per hour = N (not found; a Dali studio can quote it)",
          ["Demand", "Income a year, the room alone", "Open hours a year (2.5 h x 26 days x 12 x 44/52)", "ALL the income per open hour, CNY"], rows)
    note("Reading: the hour must cost well under the last column for the teacher to keep anything.")

    # stress test
    tests = [("as modelled", 1.0, 1.0, 1.0), ("price down 20%", 0.8, 1.0, 1.0), ("members down 30%", 1.0, 0.7, 1.0),
             ("rent up 30%", 1.0, 1.0, 1.3), ("all three", 0.8, 0.7, 1.3)]
    rows = []
    for s, c, kind in [("small", "base", "house"), ("small", "high", "house"), ("medium", "high", "house"), ("large", "high", "house"),
                       ("small", "base", "bare"), ("small", "high", "bare")]:
        row = [s, c, "rented house" if kind == "house" else "bare home room"]
        for _, pm, hm, rm in tests:
            p = pnl(s, c, kind, with_ws=True, price_mult=pm, heads_mult=hm, rent_mult=rm)
            row.append(n0(p["profit_year"] if kind == "house" else p["take_year"]))
        rows.append(row)
    table("4i. Stress test, workshops in the room included. Rented house: result a year after the owner's pay. Bare home room: what the teacher keeps a year. "
          "'Members down 30%' cuts every head count, workshop heads too; 'price down 20%' cuts every price",
          ["Size", "Demand", "Space"] + [t[0] for t in tests], rows)

    # one input at a time
    base_profit = pnl("small", "base")["profit_year"]
    watch = ["teacher_pay", "open_weeks", "lease_years_home", "price_resident_month", "price_month_list", "fitout_per_m2",
             "resident_yearly_loss", "refund_share", "owner_si_month", "rent_rise_year", "utilities_per_m2", "marketing_month", "m2_per_mat"]
    rows = []
    for name in watch:
        d = FX[name]
        lo = run_with({name: d["low"]}, lambda: pnl("small", "base")["profit_year"])
        hi = run_with({name: d["high"]}, lambda: pnl("small", "base")["profit_year"])
        rows.append((abs(hi - lo), [name, d["low"], d["base"], d["high"], d["kind"], n0(lo), n0(hi), n0(abs(hi - lo))]))
    for label, lo_set, hi_set in [
            ("season, moved together (busy 1.2 with quiet 0.5; busy 2.0 with quiet 0.85)",
             {"busy_factor": 1.2, "quiet_factor": 0.5}, {"busy_factor": 2.0, "quiet_factor": 0.85}),
            ("switch_share (0.1 to 0.4 of the existing rooms' members)",
             {("switch_share", "base"): 0.1}, {("switch_share", "base"): 0.4}),
            ("long_stayers (0 to 2)", {("long_stayers", "base"): 0}, {("long_stayers", "base"): 2}),
            ("existing_room_listed (3 to 10)", {("existing_room_listed", "base"): 3}, {("existing_room_listed", "base"): 10})]:
        lo = run_with(lo_set, lambda: pnl("small", "base")["profit_year"])
        hi = run_with(hi_set, lambda: pnl("small", "base")["profit_year"])
        rows.append((abs(hi - lo), [label, "low set", "model", "high set", "guess", n0(lo), n0(hi), n0(abs(hi - lo))]))
    rows.sort(key=lambda r: -r[0])
    table(f"4j. Which inputs move the answer most: small room in a rented house, base demand, result a year (model: {n0(base_profit)}) when one input goes to its low or its high",
          ["Input", "Low", "Model", "High", "Kind", "Result at low", "Result at high", "Swing"], [r[1] for r in rows])
    w40 = run_with({"open_weeks": 40}, lambda: pnl("small", "base")["profit_year"])
    w26 = run_with({"open_weeks": 26}, lambda: pnl("small", "base")["profit_year"])
    note(f"Open weeks: 44 gives {n0(base_profit)}; 40 gives {n0(w40)}; 26 (the existing room's printed term) gives {n0(w26)}. "
         "No cover teacher exists: when the teacher is away the room is shut.")

    # what-ifs that are not in the model
    with_course = run_with({"course_income_year": FX["course_income_year"]["high"]}, lambda: pnl("small", "base")["profit_year"])
    no_relief = pnl("small", "high", "bare", relief=False)
    relief = pnl("small", "high", "bare", relief=True)
    rows = [
        ["A month-long course of 4 at 6,000 CNY (it copies the In-Depth format at "
         f"{pct(6000 / seat_cny())} of one seat; NOT counted)", n0(base_profit), n0(with_course), n0(with_course - base_profit)],
        ["Tax reliefs end on 31 Dec 2027 (income tax no longer halved; VAT 3%): bare home room, high demand, the teacher keeps",
         n0(relief["take_year"]), n0(no_relief["take_year"]), n0(no_relief["take_year"] - relief["take_year"])],
    ]
    table("4k. Two what-ifs, CNY a year", ["What if", "Model", "With the change", "Difference"], rows)
    note("Tax: in every rented-space case the result is a loss, so income tax is 0 and the end of the reliefs changes nothing. "
         "No month reaches the 100,000 CNY VAT line.")

    # ceiling
    rows = []
    for s in ALL_SIZES:
        p = pnl(s, "high", full_room=True)
        base_members = results[(s, "base")]["avg_members"]
        rows.append([s, p["cap"], n1(p["cap"] / base_members), n1(p["cap"] / bottomup("base")), p["assistants"],
                     n0(p["income_year"] / 12), n0(p["costs_year"] / 12), n0(p["profit_year"]), n0(thb(p["profit_year"])),
                     n1(seats(p["profit_year"]))])
    table("4l. Ceiling: if every place were sold (70% settled members, 30% long-stayers; visitors as in the high case). Not a forecast",
          ["Size", "Month members", "Times the base-case members", "Times the whole town's guessed pool", "Assistants needed",
           "Income a month", "Cost a month", "Result a year", "Result a year, THB", "In 180K seats"], rows)
    return results


# ----------------------------------------------------------------------------
# STEP 5. OWNERSHIP
# ----------------------------------------------------------------------------
def wfoe_result(size, case):
    """Case (a): a foreign-owned company rents the one priced unit that can hold a licence and hires a teacher."""
    p = pnl(size, case, "oldtown", "wfoe")
    company_profit = p["surplus_before_pay"] - p["pay_month"] * 12
    if company_profit > 0:
        after_tax = company_profit * (1 - F("company_tax_rate"))
        can_pay_out = after_tax * (1 - F("company_reserve_share"))
        to_person = can_pay_out * (1 - F("dividend_tax_person"))
        to_company = can_pay_out * (1 - 0.10)
    else:
        to_person = company_profit
        to_company = company_profit
    cp = cash_and_payback(size, case, "oldtown", "wfoe")
    exit_cost = F("wfoe_exit_fixed") + p["space"]["lease_years"] * p["pay_month"] + p["setup"]["restore"]
    return dict(p=p, company_profit=company_profit, to_person=to_person, to_company=to_company,
                cash_to_open=cp["cash_to_open"], exit_cost=exit_cost)


def licence_break_even_loss(size, case, kind, royalty):
    """How far must the yearly loss of settled members fall for the owner to come out level after paying the fee?"""
    base = pnl(size, case, kind)["profit_year"]
    loss = F("resident_yearly_loss")
    while loss > 0.05:
        loss = round(loss - 0.005, 3)
        if pnl(size, case, kind, yearly_loss=loss, royalty=royalty)["profit_year"] >= base:
            return loss
    return None


OWN_NAMES = {
    "d": "(d) No shala. The same days and cash go to what already pays",
    "f": "(f) No second room: a workshop in a hired hall or a host studio (the listed teacher's welcome first)",
    "c": "(c) A graduate owns a small room, no formal tie; AYBKK teaches a workshop in it",
    "e": "(e) A partner: mornings inside a licensed studio that is already there (the files' partner-location pattern)",
    "b": "(b) A graduate owns it with an AYBKK licence and the habit system",
    "a": "(a) Boonchu owns it through a foreign-owned company and hires a teacher",
}


def aybkk_year(key, case, size="small"):
    """What AYBKK itself earns in a year, split into the room's part and the workshop part (EXAMPLE norms)."""
    in_room = workshop(case, SIZES[size]["mats"])
    in_hall = workshop(case, None)
    room = 0.0
    ws = 0.0
    if key == "a":
        room = wfoe_result(size, case)["to_person"]
        ws = in_room["n"] * in_room["net"]
    elif key == "b":
        room = 0.0                                   # blocked by the franchise rule today
        ws = in_room["n"] * in_room["net"]
    elif key == "c":
        ws = in_room["n"] * in_room["net"]
    elif key in ("e", "f"):
        ws = in_hall["n"] * in_hall["net"]
    return dict(room=room, ws=ws, total=room + ws)


def step5_ownership(size="small"):
    print()
    print(f"## STEP 5. OWNERSHIP: six cases, {size} room")
    cohort_day = cohort_day_cny()
    trip = F("workshop_trip_days")
    mats = SIZES[size]["mats"]

    # 5a the visiting teacher's side of a workshop
    rows = []
    for c in CASES:
        for label, w in [(f"in the {mats}-mat room", workshop(c, mats)), ("in a hall or a host studio", workshop(c, None))]:
            w6 = workshop(c, mats if "room" in label else None, vat_share=6.0 / 106.0)
            rows.append([c, label, n0(w["heads"]), n0(w["gross"]), n0(w["fee"]), n0(w["tax"] + w["vat"]), "**" + n0(w["net"]) + "**",
                         "**" + n0(w["per_day"]) + "**", n0(w6["net"]), n0(w["net"] - F("ws_host_cost")),
                         n0((w["net"] - F("ws_host_cost")) / trip), n0(w["host_gain"]), n0(w["net"] + w["host_gain"])])
    table("5a. One 5-day workshop, the visiting teacher's side. EXAMPLE at the published 70/30 norm; the real figure is gross x [AYBKK share]",
          ["Demand", "Where", "Students", "Gross", "Teacher's side at 70%", "Chinese tax withheld (income tax + 1% VAT)", "Net per workshop",
           f"Net per day away ({trip} days)", "Net if VAT is 6 parts in 106, not 1%", "Net if AYBKK, not the host, pays the 8,000 of travel and lodging",
           "That per day away", "Host's gain (30% less the host's cost)", "The pair: AYBKK + host"], rows)
    rows = []
    base_price = D("workshop_price", "base")
    for label, w in [(f"A {mats}-mat room, base ({n0(workshop('base', mats)['heads'])} students)", workshop("base", mats)),
                     ("A hall with 16 students", workshop("base", None, heads=16)),
                     ("A hall with 25 students", workshop("base", None, heads=25)),
                     ("43 students (the Huizhou 2026 head count, at the same price and example split)", workshop("base", None, heads=43))]:
        rows.append([label, n0(w["gross"]), n0(w["net"]), "**" + n0(w["per_day"]) + "**", n0(thb(w["per_day"])), pct(w["per_day"] / cohort_day)])
    rows.append(["One cohort teaching day (gross, before cohort costs; for scale)", "", "", "**" + n0(cohort_day) + "**", n0(thb(cohort_day)), "100.0%"])
    table(f"5b. Every use of one China day, ranked (price {n0(base_price)} CNY, EXAMPLE split; visa-free days are capped at 90 in any 180)",
          ["Use of the day", "Gross per workshop", "Net per workshop", "Net per day of his time, CNY", "THB", "Share of a cohort day"], rows)
    note("His normal stop is the number that matters here and it is missing: [net per workshop day], after the host's share, tax and travel days. Only Boonchu or the money notes can supply it.")

    # 5c case (a)
    rows = []
    for c in CASES:
        a = wfoe_result(size, c)
        g = pnl(size, c, "oldtown", "graduate")
        rows.append([c, n0(g["profit_year"]), n0(a["company_profit"]), n0(a["to_person"]), n0(a["to_company"]),
                     n0(a["p"]["pay_month"] * 12), n0(g["take_year"])])
    a_base = wfoe_result(size, "base")
    table("5c. Case (a): the room under a foreign-owned company in the one priced unit that can hold a licence (Old Town building), CNY a year",
          ["Demand", "Same room owned by a graduate (result after the owner's pay)",
           "Company result before tax (hired teacher at 8,000, social insurance on the wage, company bookkeeping and audit, company papers)",
           "Reaches the owner as a person (5% company tax, 10% kept as reserve, 20% on dividends); a loss is the owner's to fund",
           "Reaches a Thai holding company (5%, reserve, then 10%)",
           "What the hired teacher earns under (a)", "What the same person would take as the owner"], rows)
    note(f"Cash to open under (a): {n0(a_base['cash_to_open'])} CNY ({n0(thb(a_base['cash_to_open']))} THB, {n1(seats(a_base['cash_to_open']))} seats). "
         f"Cost to get out after the lease: about {n0(a_base['exit_cost'])} CNY (closing the company, about one month of pay per year worked, handing the unit back; guess). "
         f"Return on that cash at base demand: a loss of {n0(-a_base['to_person'])} a year. "
         "Workshop pay from his own Chinese company needs a work permit and a work-type residence permit (the usual line: a degree, 2 years of related work, age up to 60, with room to relax).")

    # 5d licence, for scale only
    rows = []
    for c in CASES:
        p = pnl(size, c)
        sales = p["income_year"]
        roy7 = sales * FX["example_royalty"]["low"] * F("licence_fee_net_share")
        roy9 = sales * FX["example_royalty"]["high"] * F("licence_fee_net_share")
        with_fee = pnl(size, c, royalty=FX["example_royalty"]["low"])
        need = licence_break_even_loss(size, c, "house", FX["example_royalty"]["low"])
        need_text = (f"from {pct(1 - F('resident_yearly_loss'))} to {pct(1 - need)}" if need is not None else "cannot be reached")
        rows.append([c, n0(sales), n0(roy7), n0(roy9), n0(thb(roy7)), n2(seats(roy7)),
                     n0(p["profit_year"]), n0(with_fee["profit_year"]), need_text])
    table("5d. Case (b), FOR SCALE ONLY (it is blocked by law today): licence income = sales x [licence fee] x 84.91%. EXAMPLE with a published 7% and 9%",
          ["Demand", "The room's sales a year", "Example: 7% of sales, net of Chinese tax", "Example: 9%, net", "7% example in THB",
           "7% example in 180K seats", "Owner's result before any fee", "Owner's result after a 7% fee",
           "Yearly retention of settled members the habit system must reach for the owner to come out level on 7%"], rows)
    p_base = pnl(size, "base")
    roy_base = p_base["income_year"] * FX["example_royalty"]["low"] * F("licence_fee_net_share")
    cohort = 12 * seat_cny()
    pre_cash = 2 * a_base["cash_to_open"]
    note(f"Why (b) is 0 today. The franchise rule asks for a company with 2 directly run shops, each open over 1 year, and a filing within 15 days of the first contract. "
         "AYBKK has 1 directly run shala. Foreign papers are accepted with legalisation (filing measures, opened by the checker), so the missing piece is a second room, "
         f"which is case (a): if only mainland shops count, that is 2 x {n0(a_base['cash_to_open'])} = {n0(pre_cash)} CNY ({n1(seats(pre_cash))} seats) and "
         f"{2 * F('wfoe_setup_days')} set-up days, for rooms that lose money at base demand. The lowest fine (100,000 CNY) is {n1(100000 / roy_base)} years of this room's 7% fee.")
    note(f"Scale. One room at base pays {n0(roy_base)} CNY a year at the 7% example. [graduates with a running room] is N (Carne counts; two full cohorts are at most 24 people). "
         f"If all 24 ran a room like this: 24 x {n0(roy_base)} = {n0(24 * roy_base)} CNY = {n2(seats(24 * roy_base))} seats = {pct(24 * roy_base / cohort)} of one cohort. "
         f"For licences to equal one cohort ({n0(cohort)} CNY) the licensed rooms must sell {n0(cohort / (FX['example_royalty']['low'] * F('licence_fee_net_share')))} CNY a year between them. "
         "Not counted: [China build cost] of the habit software (it is built for Bangkok: Thai payments, LINE), a Chinese company to hold health data and a mini-program, and a trademark.")

    # 5e partner room
    rows = []
    for c in CASES:
        row = [c]
        for share in [FX["example_studio_share"]["low"], FX["example_studio_share"]["base"], FX["example_studio_share"]["high"]]:
            p = run_with({"example_studio_share": share}, lambda: pnl(size, c, "partner"))
            row.append(n0(p["profit_year"]))
        p = pnl(size, c, "partner")
        row.append(n0(p["take_year"]))
        row.append(n0(p["daily_sales"]))
        rows.append(row)
    cp_partner = cash_and_payback(size, "base", "partner")
    table("5e. Case (e): a morning Mysore room inside a partner's licensed studio. The operator's result a year, with a teacher paid 6,000 a month",
          ["Demand", "Studio keeps 30% of daily sales", "Studio keeps 40%", "Studio keeps 50%",
           "If the teacher draws no fixed pay (studio keeps 40%): what is left", "Daily sales a year"], rows)
    note(f"Cash at risk in (e): {n0(cp_partner['cash_to_open'])} CNY (props, opening week, 6 months of the teacher's pay and running cost). No lease, no fit-out, no licence address to find, "
         "and it can be closed in a month. AYBKK's part = the operator's result x [AYBKK share] x 84.91% if paid to a Thai company; with a loss at low and base demand that part is 0. "
         "The 30% to 50% is a published range used as an example; any real split is private: [partner share]. "
         "Real data for this case may exist: was the first partner location signed, and what did it earn? Only Boonchu knows.")

    # 5f the summary of the six cases
    legal = {
        "d": "None.",
        "f": "The same position as every China stop, and it is not safe: a 2014 rule on short-term work lists work done for a Chinese partner (a law firm's list, opened by the checker, not by me), and visa-free entry does not cover work. "
             "The teacher risks 5,000 to 20,000 CNY and a ban of 1 to 5 years if sent home; the host risks 10,000 CNY and the gains. LAWYER before any Dali date.",
        "c": "As (f), plus a fixed room that sells the same foreign teacher's workshop is a repeated public record at one address. Without an invoice for the teacher's fee the host is taxed on the whole workshop. "
             "The owner, a Chinese citizen with an individual business, pays no VAT under 100,000 CNY a month and halved income tax to 31 Dec 2027.",
        "e": "A joint company with any foreign share carries all of (a). A room under the AYBKK name inside the partner's business, with a split, is a licence again and meets the 2-shops rule. "
             "AYBKK cannot directly run a room in China without its own Chinese company. LAWYER: does a split without the name (a teaching service contract) stay outside the franchise rule?",
        "b": "BLOCKED. Name + method + fees is a franchise. The franchisor must be a company with 2 directly run shops open over 1 year; AYBKK has 1. Fine 100,000 to 500,000 CNY; a deal signed by a person can be void (Supreme People's Court, Aug 2026). "
             "The course gives a certificate of completion only, so no room may say or hint that it gives authorization; in Chinese contracts write 商标许可.",
        "a": "Must be a company: a foreigner cannot hold an individual business (negative list 2024, note 2). Yoga is not on the negative list. A company cannot sit in a home: it needs a unit that can hold a licence and pass the fire step. "
             "Teaching in it needs a work permit. Profit leaves as dividends with audited accounts. Not legal or tax advice.",
    }
    kill = {
        "d": "A graduate in Yunnan asks to host and gets no answer; 'not now' turns into 'never look'.",
        "f": "Small heads (the host does not cover the cost under about 7); work rules (a ban ends every China stop); the listed teacher's welcome, which nobody has asked for; no host known in Dali.",
        "c": "The room itself: it loses money in every demand case, so it closes in public after he has taught in it. Members taken from the listed teacher. Any hint of authorization.",
        "e": "The operator loses money at base demand with a paid teacher; the studio must want it; the same welcome question; whose name is on the door.",
        "b": "The law. An owner with a loss cannot pay a fee. The habit software needs a China build. Quality in a room he does not see.",
        "a": "Base demand does not pay a hired teacher (and nobody in Dali is known who could be hired); a company cannot use the cheap homes; a hired worker is owed about one month of pay per year worked when the company closes; money out of China (a host transfer was blocked in July 2026); who runs Bangkok.",
    }
    days_text = {}
    days_n = {}
    wb = workshop("base", mats)
    ws_days = wb["n"] * trip
    days_n["d"] = 0; days_text["d"] = "0"
    days_n["f"] = ws_days; days_text["f"] = f"{n0(ws_days)} ({wb['n']} trip of {trip} days)"
    days_n["c"] = ws_days; days_text["c"] = f"{n0(ws_days)} ({wb['n']} trip of {trip} days)"
    days_n["e"] = ws_days + F("licence_support_days")
    days_text["e"] = f"{n0(days_n['e'])} ({n0(ws_days)} teaching + {n0(F('licence_support_days'))} support)"
    days_n["b"] = ws_days + F("licence_support_days")
    days_text["b"] = f"{n0(days_n['b'])} ({n0(ws_days)} teaching + {n0(F('licence_support_days'))} support)"
    days_n["a"] = ws_days + F("wfoe_setup_days") + F("wfoe_manage_days")
    days_text["a"] = (f"{n0(days_n['a'])} in year 1 ({n0(F('wfoe_setup_days'))} set-up + {n0(F('wfoe_manage_days'))} managing + {n0(ws_days)} teaching); "
                      f"{n0(ws_days + F('wfoe_manage_days'))} a year after")
    cash_in = {"d": 0.0, "f": 0.0, "c": 0.0, "e": 0.0, "b": 0.0, "a": a_base["cash_to_open"]}
    lawful = {"d": "yes", "f": "not settled", "c": "not settled", "e": "not settled", "b": "NO", "a": "yes for the company; the teaching needs a work permit"}
    owner_take = pnl(size, "base")["take_year"]
    min_wage_year = F("min_wage_month") * 12
    lasts = {
        "d": "n/a",
        "f": "n/a: no room to keep alive",
        "c": (f"NO: the owner's take is {n0(owner_take)} a year at base, under the minimum wage ({n0(min_wage_year)}). The room closes; after that this case is (f)"),
        "e": "Only while the studio and the teacher both accept a loss",
        "b": "As (c): the room closes",
        "a": "Only while he funds the loss",
    }
    out = {}
    rows = []
    rows_text = []
    for key in ["d", "f", "c", "e", "b", "a"]:
        vals = [aybkk_year(key, c, size) for c in CASES]
        b = vals[1]
        out[key] = dict(vals=[v["total"] for v in vals], room_parts=[v["room"] for v in vals], ws_parts=[v["ws"] for v in vals],
                        days_n=days_n[key], cash_in=cash_in[key])
        if days_n[key]:
            per_day = b["total"] / days_n[key]
            less_days = f"{n0(b['total'])} - {n0(days_n[key])} x [net per workshop day]"
            beats = (f"only if [net per workshop day] is under {n0(per_day)} CNY ({n0(thb(per_day))} THB)" if per_day > 0 else "never: it is a loss before his days are counted")
        else:
            per_day = 0.0
            less_days = "0"
            beats = "n/a: these days stay with what already pays"
        rows.append([OWN_NAMES[key], lawful[key], n0(vals[0]["total"]), "**" + n0(b["total"]) + "**", n0(vals[2]["total"]),
                     n0(b["room"]), n0(b["ws"]), n0(thb(b["total"])), n2(seats(b["total"])),
                     days_text[key], n0(per_day) if days_n[key] else "n/a", less_days, beats,
                     n0(cash_in[key])])
        rows_text.append([OWN_NAMES[key], lawful[key], lasts[key], legal[key], kill[key]])
    table("5f. What AYBKK itself earns in a year, CNY, by case (sorted from least of his time to most). Workshop lines use the EXAMPLE 70/30 split, not AYBKK terms",
          ["Case", "Lawful today?", "Low demand", "Base demand", "High demand", "Base: from the room itself (dividend or licence)",
           "Base: from the workshop he teaches there", "Base, THB", "Base, in 180K seats", "Boonchu's days a year (base)",
           "AYBKK income per day of his time (base)", "What is left after his days", "It beats his next-best China day",
           "Cash AYBKK puts in"], rows)
    wl = workshop("low", mats)
    note(f"The host's side of that workshop: at low demand the host loses {n0(-wl['host_gain'])} CNY and at base {n0(-wb['host_gain'])} CNY (30% share less a cost of {n0(F('ws_host_cost'))}; table 5a). "
         "A host who loses money will not pass yesterday's gate (a room, papers and paid deposits), and then the workshop lines above are 0.")
    table("5g. The same six cases in words",
          ["Case", "Lawful today?", "Does the room last?", "Legal position", "What could kill it"], rows_text)
    hi_room = workshop("high", mats); hi_hall = workshop("high", None)
    note(f"What a room adds over a hall. Base: {n0(out['c']['vals'][1] - out['f']['vals'][1])} CNY (7 students fit on 10 mats). "
         f"High: {n0(out['c']['vals'][2])} in the room against {n0(out['f']['vals'][2])} in a hall, so the 10-mat room costs AYBKK {n0(out['f']['vals'][2] - out['c']['vals'][2])} CNY a year "
         f"({n0(hi_room['heads'])} students against {n0(hi_hall['heads'])}). A graduate's room adds nothing to AYBKK's income and takes heads away when demand is good.")
    note("What a ban would cost: [yearly net of all China stops] x 1 to 5 years. Only Boonchu has that number. It is the price tag on the 'not settled' rows above.")
    note("Seats sent. The one way a graduate's room could matter is by sending students to the In-Depth course: seats sent a year x "
         f"{n0(seat_cny())} CNY, 0 days of his time. [seats sent per room a year] is N (Carne can count the source city and room of every seat in cohorts 1 to 3). "
         f"A room that sends {n2(roy_base / seat_cny())} seat a year already equals the 7% licence example; 1 seat a year is {n1(seat_cny() / roy_base)} times that. "
         "Judge any graduate's room by seats sent and workshop heads, not by a fee.")
    note("The name. In every case, 'no shala' included, the name is not protected in China: nobody has searched whether AYBKK or Ashtanga Yoga Bangkok is filed in class 41. "
         "Search and file: 270 CNY official fee online plus an agent's fee N; examination took 4 months on average in 2025. A paper step that needs Boonchu's go.")
    note(f"Day count (ESTIMATE): 2026 had {F('china_days_2026')} teaching days in China over {F('china_stops_2026')} stops; with a travel day each side that is about "
         f"{F('china_days_2026') + 2 * F('china_stops_2026')} days. One Dali trip adds {n0(trip)}: about {n0(F('china_days_2026') + 2 * F('china_stops_2026') + trip)} "
         f"of the {F('visa_free_days')} visa-free days in any 180, if all fell in one window. A daily room taught by Boonchu himself needs about "
         f"{n0(F('practice_days_per_month') * F('open_weeks') / 52 * 12)} teaching days a year, which visa-free entry cannot cover. "
         "No dates are set in this model, so the rolling count, the count at entry and the family school calendar were not run on dates.")
    return out


# ----------------------------------------------------------------------------
# STEP 6. COMPARE
# ----------------------------------------------------------------------------
def step6_compare(own, size="small"):
    print()
    print("## STEP 6. COMPARE with one seat of the 180K course and with the yearly goal")
    seat = seat_cny()
    goal_cny = M["goal_thb"]["base"] / M["thb_per_cny"]["base"]
    cohort_cny = 12 * seat
    note(f"One seat = 180,000 THB = {n0(seat)} CNY. One full cohort = 12 seats = {n0(cohort_cny)} CNY. Goal = 33,000,000 THB = {n0(goal_cny)} CNY a year (the files mark the goal as a guess).")

    rows = []
    for label, kind in [("Rented house, owner paid 6,000 a month", "house"), ("Bare home room, no fixed pay", "bare")]:
        for c in CASES:
            p = pnl(size, c, kind)
            v = p["profit_year"] if kind == "house" else p["take_year"]
            rows.append([label, c, n0(v), n0(thb(v)), n2(seats(v)), pct2(v / goal_cny), n0(p["take_year"]), n2(seats(p["take_year"]))])
    table(f"6a. To the owner of a {size} room, a year, the room alone",
          ["Form", "Demand", "Result (rented house: after pay; bare room: what the teacher keeps), CNY", "THB", "In 180K seats", "Share of the 33M goal",
           "The owner's whole take (pay + result), CNY", "Whole take in seats"], rows)

    rows = []
    for key in ["d", "f", "c", "e", "b", "a"]:
        v = own[key]["vals"][1]
        room = own[key]["room_parts"][1]
        days = own[key]["days_n"]
        if v > 0:
            per_seat = n1(seat / v); per_cohort = n0(cohort_cny / v); per_goal = n0(goal_cny / v)
            goal_days = n0(goal_cny / v * days)
        else:
            per_seat = per_cohort = per_goal = goal_days = "never (zero or a loss)"
        rows.append([OWN_NAMES[key], n0(v), n0(thb(v)), n2(seats(v)), pct2(v / goal_cny), n0(room), n2(seats(room)),
                     per_seat, per_cohort, per_goal, goal_days])
    table("6b. To AYBKK, base demand, a year (the workshop he teaches included; EXAMPLE split)",
          ["Case", "CNY", "THB", "In 180K seats", "Share of the 33M goal", "Of which on days he does not teach (the room itself)", "That in seats",
           "Years of this to equal one seat", "Years to equal one full cohort", "Rooms or trips like this to equal the goal",
           "His days a year at that many"], rows)

    w = workshop("base", SIZES[size]["mats"])
    cohort_day = cohort_day_cny()
    trip = F("workshop_trip_days")
    note(f"Time wall. 30 days in a cohort = 12 seats (gross). 30 days of Dali trips at the base case = {n2(30 / trip)} trips x {n0(w['net'])} CNY = "
         f"{n0(30 / trip * w['net'])} CNY = {n2(seats(30 / trip * w['net']))} seats. No case moves toward 33 million THB: the best case that is not blocked is "
         f"{pct2(own['f']['vals'][1] / goal_cny)} of the goal with his days, and every case is 0 or a loss on days he does not teach.")
    p = pnl(size, "base")
    note(f"Stakes in AYBKK's own pocket: one more paid seat in cohort 3 ({n0(seat)} CNY, 0 extra days) equals {n1(seat / w['net'])} of his 7-day Dali trips at the base case. "
         f"To the room's owner: the rented small room loses {n0(-p['profit_year'])} CNY a year at base demand, which is {n1(-p['profit_year'] / seat)} seats of the course, every year.")
    bkk_month_cny = 9600 / M["thb_per_cny"]["base"]
    note(f"For scale: the Bangkok 1-month pass is 9,600 THB before VAT = {n0(bkk_month_cny)} CNY (the same in both price lists in the files, which otherwise conflict). "
         f"A Dali Mysore month at {n0(F('price_month_list'))} CNY is {pct(F('price_month_list') / bkk_month_cny)} of it. "
         "Bangkok's own members, cost and net are not in the files: [Bangkok members], [Bangkok monthly cost], [Bangkok net], [Bangkok class capacity]. Only Boonchu can supply them.")


# ----------------------------------------------------------------------------
# what moved since version 1
# ----------------------------------------------------------------------------
def what_moved():
    print()
    print("## WHAT MOVED SINCE VERSION 1")
    v1 = INPUTS["v1"]
    b = pnl("small", "base")
    be = break_even("small", "base")
    cp = cash_and_payback("small", "base")
    sc = area_scores(True)
    by_key = {a["key"]: a for a in sc}
    wsb = workshop("base", SIZES["small"]["mats"])
    rows = [
        ["Month members, base case", n1(v1["members_base"]), n1(b["avg_members"])],
        ["Small room, result a year, low", n0(v1["small_low"]), n0(pnl("small", "low")["profit_year"])],
        ["Small room, result a year, base", n0(v1["small_base"]), n0(b["profit_year"])],
        ["Small room, result a year, high", n0(v1["small_high"]), n0(pnl("small", "high")["profit_year"])],
        ["Medium room, base", n0(v1["medium_base"]), n0(pnl("medium", "base")["profit_year"])],
        ["Large room, base", n0(v1["large_base"]), n0(pnl("large", "base")["profit_year"])],
        ["Break-even on month members alone, small", n1(v1["breakeven_alone"]), n1(be["alone"])],
        ["Cash needed to open, small", n0(v1["cash_to_open"]), n0(cp["cash_to_open"])],
        ["AYBKK a year, case (c), base (example split)", n0(v1["aybkk_c"]), n0(aybkk_year("c", "base")["total"])],
        ["AYBKK a year, case (b), base", n0(v1["aybkk_b"]), "0 from the licence (blocked); " + n0(aybkk_year("b", "base")["total"]) + " from a workshop"],
        ["AYBKK a year, case (a), base", n0(v1["aybkk_a"]), n0(aybkk_year("a", "base")["total"])],
        ["AYBKK net per day away, case (c), base", n0(v1["per_day_c"]), n0(wsb["per_day"])],
        ["Top area", v1["top_area"], f"none proven; A2 scores highest ({by_key['A2']['score']}), C is the only one with a space that can hold a licence ({by_key['C']['score']}), B has {by_key['B']['score']}"],
    ]
    table("M1. Version 1 against version 2 (version 1 figures are copied from its output file)", ["Line", "Version 1", "Version 2"], rows)

    base = b["profit_year"]
    v1_space = {"shop_unit_rent_per_m2": 48.1, "lease_years_shop": 5, "papers_shop_cny": 2000, "rent_rise_year": 0.0,
                "prelaunch_rent_months": 0.0, "agent_fee_months": 0.0, "restore_share": 0.0}
    steps = [
        ("Heads as in version 1 (4 settled members paying all year, 2 long-stayers)",
         {"residents_paying": 4.0, ("long_stayers", "base"): 2}, "house", False),
        ("Prices as in version 1 (1,250 settled, 1,500 list)",
         {"price_resident_month": 1250, "price_month_list": 1500}, "house", False),
        ("Week cards and drop-ins as in version 1 (3 and 6 a month)",
         {("visitor_weeks_per_month", "base"): 3, ("drop_ins_per_month", "base"): 6}, "house", False),
        ("Season and weeks as in version 1 (5 busy months, 48 open weeks)",
         {"busy_months": 5, "open_weeks": 48}, "house", False),
        ("Space as in version 1 (a 53 m2 unit at 48.1 per m2 that nobody offers, 5-year lease, no rent rise, no rent before opening, no agent, no hand-back cost)",
         v1_space, "shop53", False),
        ("Left-out costs as in version 1 (no social insurance for the owner, no refunds)",
         {"owner_si_month": 0, "refund_share": 0.0}, "house", False),
        ("Events as in version 1 (2 workshops of 10 at 4,100 with no host cost, and a month course worth 24,000)",
         {("workshops_per_year", "base"): 2, ("workshop_heads_wanted", "base"): 16, ("workshop_price", "base"): 4100,
          "ws_host_cost": 0, "course_income_year": 24000}, "house", True),
    ]
    rows = []
    everything = {}
    for label, changes, kind, ws_on in steps:
        v = run_with(changes, lambda: pnl("small", "base", kind, with_ws=ws_on)["profit_year"])
        rows.append([label, n0(v), n0(base - v)])
        everything.update(changes)
    v_all = run_with(everything, lambda: pnl("small", "base", "shop53", with_ws=True)["profit_year"])
    rows.append(["All seven together", n0(v_all), n0(base - v_all)])
    table(f"M2. Small room, base case: version 2 gives {n0(base)} a year. What each group of changes is worth, put back one at a time",
          ["If only this were as in version 1", "The result would be", "So this change moved the answer by"], rows)
    note(f"All seven together give {n0(v_all)}; version 1 printed {n0(v1['small_base'])}. The {n0(v_all - v1['small_base'])} between them is the personal allowance of "
         f"{n0(F('iit_allowance'))} CNY, which version 1 did not take off before income tax. So version 2 holds version 1 inside it, and the seven groups explain the whole move. "
         "The groups overlap, so they do not add up line by line.")


# ----------------------------------------------------------------------------
# two rows worked by hand
# ----------------------------------------------------------------------------
def worked_rows():
    print()
    print("## TWO ROWS WORKED BY HAND (so a reader can follow the sums line by line)")
    c = "base"
    sw = DM["switch_share"][c]; bu = bottomup(c); made = DM["new_practitioners"][c]
    places = sw * bu + made
    loss = F("resident_yearly_loss"); gap = F("replace_gap_months")
    paying = places * (1 - loss * gap / 12)
    lng = DM["long_stayers"][c]; wk = DM["visitor_weeks_per_month"][c]; dr = DM["drop_ins_per_month"][c]
    pr = F("price_resident_month"); pl = F("price_month_list"); pw = F("price_week"); pd = F("price_drop_in")
    bf = F("busy_factor"); qf = F("quiet_factor"); nb = F("busy_months"); nq = 12 - nb; osh = F("open_weeks") / 52.0
    busy_m = paying * pr + lng * bf * pl
    quiet_m = paying * pr + lng * qf * pl
    members_year = (nb * busy_m + nq * quiet_m) * osh
    busy_v = wk * bf * pw + dr * bf * pd
    quiet_v = wk * qf * pw + dr * qf * pd
    visitors_year = (nb * busy_v + nq * quiet_v) * osh
    refunds = (members_year + visitors_year) * F("refund_share")
    income = members_year + visitors_year - refunds
    mats = SIZES["small"]["mats"]
    practice = mats * F("m2_per_mat"); total = practice / F("practice_share_of_floor")
    rent0 = 5500.0
    rent = rent0 * (1 + (1 + F("rent_rise_year"))) / 2
    prop = total * F("property_fee_per_m2"); util = total * F("utilities_per_m2")
    heat = practice * F("heat_kw_per_m2") * F("heat_hours_per_day") * F("practice_days_per_month") * F("kwh_price") * F("heat_months") / 12
    si = F("owner_si_month"); clean = SIZES["small"]["cleaning_hours"] * F("hourly_wage"); mk = F("marketing_month")
    ins = F("insurance_year") / 12; bk = F("bookkeeping_month")
    fitout = total * F("fitout_per_m2"); props = mats * F("props_per_mat"); kit = practice * F("heating_kit_per_m2")
    setup = (fitout + props + kit + F("papers_home_cny") + F("opening_marketing")
             + rent0 * F("prelaunch_rent_months") + rent0 * F("agent_fee_months"))
    wear = (setup + fitout * F("restore_share")) / (F("lease_years_home") * 12)
    fixed = rent + prop + util + heat + si + clean + mk + ins + bk + wear
    fee = income * F("payment_fee")
    result = income - fixed * 12 - fee - F("teacher_pay") * 12
    p = pnl("small", "base")
    lines = [
        f"Row 1: small room, base demand, rented house, the room alone.",
        f"  places = {sw} x {bu} + {made} = {n2(places)}; paying = {n2(places)} x (1 - {loss} x {gap}/12) = {n2(paying)}",
        f"  busy month, members = {n2(paying)} x {n0(pr)} + {lng} x {bf} x {n0(pl)} = {n2(busy_m)}; quiet month = {n2(paying)} x {n0(pr)} + {lng} x {qf} x {n0(pl)} = {n2(quiet_m)}",
        f"  members a year = ({nb} x {n2(busy_m)} + {nq} x {n2(quiet_m)}) x {F('open_weeks')}/52 = {n0(members_year)}",
        f"  busy month, visitors = {wk} x {bf} x {n0(pw)} + {dr} x {bf} x {n0(pd)} = {n2(busy_v)}; quiet = {n2(quiet_v)}; a year = ({nb} x {n2(busy_v)} + {nq} x {n2(quiet_v)}) x {F('open_weeks')}/52 = {n0(visitors_year)}",
        f"  refunds = 3% x ({n0(members_year)} + {n0(visitors_year)}) = {n0(refunds)}; income = {n0(income)}",
        f"  floor = {mats} x {F('m2_per_mat')} = {n0(practice)} m2 practice / {F('practice_share_of_floor')} = {n1(total)} m2",
        f"  rent = 5,500 x (1 + 1.05) / 2 = {n1(rent)}; property fee {n1(prop)}; water, light, internet {n1(util)}; heating {n1(heat)}; own social insurance {n0(si)}; "
        f"cleaning {SIZES['small']['cleaning_hours']} h x {F('hourly_wage')} = {n0(clean)}; marketing {n0(mk)}; insurance {n1(ins)}; bookkeeping {n0(bk)}",
        f"  set-up = fit-out {n0(fitout)} + props {n0(props)} + heating kit {n0(kit)} + papers {n0(F('papers_home_cny'))} + opening {n0(F('opening_marketing'))} "
        f"+ rent before opening {n0(rent0 * F('prelaunch_rent_months'))} + agent {n0(rent0 * F('agent_fee_months'))} = {n0(setup)}",
        f"  wear = ({n0(setup)} + hand-back {n0(fitout * F('restore_share'))}) / 24 months = {n1(wear)} a month",
        f"  cost a month before the owner's pay = {n1(fixed)}; payment fees a year = {n0(fee)}",
        f"  result = {n0(income)} - 12 x {n1(fixed)} - {n0(fee)} - 12 x {n0(F('teacher_pay'))} = {n0(result)}",
        f"  The model's table says: income {n0(p['income_year'])}, result {n0(p['profit_year'])}. Difference: {n2(result - p['profit_year'])}.",
    ]
    for l in lines:
        print(l)
    w = workshop("base", mats)
    heads = min(DM["workshop_heads_wanted"]["base"], mats)
    gross = heads * DM["workshop_price"]["base"]
    fee_t = gross * F("example_teacher_share")
    t = fee_t * 0.8
    tax = t * 0.20 - 1410
    vat = fee_t * F("vat_rate")
    net = fee_t - tax - vat
    lines = [
        "",
        "Row 2: one workshop in the 10-mat room, base demand, the visiting teacher's side (table 5a).",
        f"  students = the smaller of {DM['workshop_heads_wanted']['base']} who would pay and {mats} mats = {heads}; gross = {heads} x {n0(DM['workshop_price']['base'])} = {n0(gross)}",
        f"  teacher's side at the example 70% = {n0(fee_t)}; taxed part = 80% = {n1(t)}, which sits in the 20% band (12,000 to 25,000): tax = {n1(t)} x 20% - 1,410 = {n2(tax)}",
        f"  VAT 1% = {n2(vat)}; net = {n0(fee_t)} - {n2(tax)} - {n2(vat)} = {n2(net)}; per day away = {n2(net)} / 7 = {n2(net / 7)}",
        f"  host: {n0(gross)} x 30% = {n0(gross * 0.3)} less the host's cost {n0(F('ws_host_cost'))} = {n0(gross * 0.3 - F('ws_host_cost'))}",
        f"  The model's table says: net {n0(w['net'])}, per day {n0(w['per_day'])}, host's gain {n0(w['host_gain'])}. Difference in net: {n2(net - w['net'])}.",
    ]
    for l in lines:
        print(l)


# ----------------------------------------------------------------------------
# lists, assumptions and run
# ----------------------------------------------------------------------------
def lawyer_only():
    print()
    print("## WHAT ONLY A CHINESE LAWYER OR TAX ADVISER CAN SETTLE (this model is not legal or tax advice)")
    items = [
        "Does a paid 5-day workshop at a host studio need short-term work papers, and which visa? Can a Thai company invoice the host instead? Who is the organiser on paper? (Before any Dali date; it covers every China stop.)",
        "Does Dali's market office register a business licence at a home address, and on what consent of the neighbours?",
        "Title and planning status of the Canghai Yishu and Xiaoyuanzi estates, and the official Erhai zone of any exact plot.",
        "Does a paid yoga room of about 50 m2 need the pre-opening fire safety step in Dali, and a hygiene licence if there is no shower?",
        "Does a name-free software or teaching deal, or a split inside a partner's studio, stay outside the franchise rule? Can the In-Depth course fee itself be read as a franchise fee? Do shops outside China count toward the two shops?",
        "A work permit for an owner who teaches in his own company (degree, 2 years of related work, the age line of 60).",
        "Pass and course terms under the 2025 prepaid rules; a lease clause on who owns the fit-out and a fixed rent path; the owner's written consent before any transfer fee is paid.",
        "VAT rate on a visiting foreign teacher's fee (1% or 6 parts in 106); tax on dividends to a foreign person (20% is the checker's reading); how money may leave China after the transfer that was blocked in July 2026.",
        "Health data (resting heart rate, sleep) of students in China on a server abroad, and a WeChat mini-program, for the habit system.",
    ]
    for i in items:
        print("- " + i)


def not_counted():
    print()
    print("## WHAT THE MODEL DOES NOT COUNT")
    items = [
        "The owner's own home rent (in the bare home room the room pays none of it).",
        "Any transfer fee for taking over a lease (the Old Town building's fee is 'very low', amount not stated; main streets ask 90,000 to 580,000).",
        "Hall hire for a workshop (no Dali price found): [hall hire]. The host pays it.",
        "The cost of making the habit software work in China: [China build cost].",
        "What Boonchu's days away cost the Bangkok shala: [Bangkok net per day]. The cohort teaching-day rate is gross and shown for scale only; cohort costs are in no file.",
        "Students the Dali room might send on to Bangkok or to the In-Depth course: [seats sent per room a year] = N.",
        "The answer of the teacher of the existing Mysore room. Nobody has asked. It changes the area table and the demand table.",
        "A housing fund for hired staff, and a higher social insurance base if the Yunnan notice for 2026 to 2027 raised it.",
        "A month-long course in the Dali room (it copies the In-Depth format; shown as a what-if in 4k).",
    ]
    for i in items:
        print("- " + i)


def print_assumptions():
    print()
    print("## ASSUMPTIONS (every input, with its kind)")
    rows = []
    for name, d in DM.items():
        rows.append([name, d["low"], d["base"], d["high"], d["unit"], d["kind"], d["basis"]])
    table("Demand inputs (low, base and high are the three cases)", ["Input", "Low", "Base", "High", "Unit", "Kind", "Basis"], rows)
    rows = []
    for name, d in FX.items():
        rows.append([name, d["low"], d["base"], d["high"], d["unit"], d["kind"], d["basis"]])
    table("Other inputs (the model uses Base; Low and High show how unsure it is)", ["Input", "Low", "Base", "High", "Unit", "Kind", "Basis"], rows)
    rows = []
    for name, d in M.items():
        rows.append([name, d["low"], d["base"], d["high"], d["unit"], d["kind"], d["basis"]])
    table("Money", ["Input", "Low", "Base", "High", "Unit", "Kind", "Basis"], rows)
    rows = []
    for name, z in SIZES.items():
        rows.append([name, f"{z['mats']} ({z['mats_low']} to {z['mats_high']})", z["helper_hours"], z["cleaning_hours"]])
    table("Sizes (helper and cleaning hours a month are guesses: a micro or small room is run by the teacher alone)",
          ["Size", "Mats (range)", "Helper hours a month (guess)", "Cleaning hours a month (guess)"], rows)
    kinds = {}
    for group in (DM, FX, M):
        for d in group.values():
            kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
    note("Count of inputs by kind: " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())) + ".")


def summary():
    print()
    print("## SUMMARY IN NUMBERS (all computed below)")
    by_size = {s: pnl(s, "base")["profit_year"] for s in MAIN_SIZES}
    least = max(by_size, key=by_size.get)
    practice, total = floor_m2("small")
    mp, mt = floor_m2("micro")
    cp = cash_and_payback("small", "base")
    be = break_even("small", "base")
    sc = area_scores(True)
    by_key = {a["key"]: a for a in sc}
    note(f"Answer in numbers. No size of rented room pays in any demand case. Of the three sizes asked for, {least} loses least at base demand. "
         f"The base case is {n1(pnl('small', 'base')['avg_members'])} month members; a small room in the cheapest real space needs {n1(be['alone'])} to pay its teacher 6,000 a month and can serve {capacity_members('small')}. "
         f"The only form that leaves its teacher anything is a bare home room of about {SIZES['micro']['mats']} mats ({n0(mp)} m2 of practice floor, {n0(mt)} m2 in all). "
         f"Area: none is proven; A2 scores {by_key['A2']['score']}, C {by_key['C']['score']}, B {by_key['B']['score']} of 75.")
    rows = []
    for c in CASES:
        p = pnl("small", c)
        b = pnl("micro", c, "bare")
        rows.append([c, n1(p["avg_members"]), n0(p["income_year"]), n0(thb(p["income_year"])), n0(p["profit_year"]), n0(thb(p["profit_year"])),
                     n2(seats(p["profit_year"])), n0(p["take_year"] / 12), n0(b["take_year"]), n0(b["take_year"] / 12), n0(thb(b["take_year"] / 12))])
    table("S1. Three demand cases, a year, the room alone (no workshop, no month course)",
          ["Demand", "Month members (average)", "Income, CNY", "Income, THB",
           "Small room in a rented house: result after the owner-teacher's pay of 6,000 a month", "That in THB", "In 180K seats",
           "Small rented room: owner's take a month (pay + result)",
           "Bare home room of 6 mats: what the teacher keeps a year", "That a month", "A month, THB"], rows)
    rows = []
    for s in ALL_SIZES:
        z = SIZES[s]
        pr, tt = floor_m2(s)
        row = [s, z["mats"], n0(pr), n0(tt), capacity_members(s)]
        for c in CASES:
            row.append(n0(pnl(s, c)["profit_year"]))
        row.append(n0(cash_and_payback(s, "base")["cash_to_open"]))
        row.append(n1(break_even(s, "base")["alone"]))
        rows.append(row)
    table("S2. Result a year by size and demand in a rented house, the room alone, CNY",
          ["Size", "Mats", "Practice room m2", "Total m2", "Month members it can serve", "Low", "Base", "High",
           "Cash needed to open (base)", "Break-even month members"], rows)
    rows = []
    for key in ["d", "f", "c", "e", "b", "a"]:
        vals = [aybkk_year(key, c) for c in CASES]
        rows.append([OWN_NAMES[key], n0(vals[0]["total"]), n0(vals[1]["total"]), n0(vals[2]["total"]), n0(vals[1]["room"]), n2(seats(vals[1]["total"]))])
    table("S3. What AYBKK itself earns in a year by ownership case, CNY (EXAMPLE 70/30 workshop split; the licence counts as 0 because it is blocked)",
          ["Case", "Low", "Base", "High", "Base: of which from the room on days he does not teach", "Base, in 180K seats"], rows)
    note(f"Cash needed to open a small rented room: {n0(cp['cash_to_open'])} CNY ({n0(thb(cp['cash_to_open']))} THB, {n1(seats(cp['cash_to_open']))} seats of the 180K course). "
         f"By month 24, when the first home lease ends, the owner has put in {n0(-cp['at24'])} CNY at base demand. It is not earned back in any case.")


def main():
    print("# Dali Ashtanga shala model, version 2: output tables")
    print()
    print("Run on Mon 23 Nov 2026. CNY unless marked. 1 CNY = 5.066 THB. Every figure below is printed by dali-shala-model-v2.py.")
    summary()
    what_moved()
    step0_cities()
    step1_demand()
    step2_size()
    step3_area()
    step4_income()
    own = step5_ownership("small")
    step6_compare(own, "small")
    worked_rows()
    lawyer_only()
    not_counted()
    print_assumptions()


if __name__ == "__main__":
    main()
