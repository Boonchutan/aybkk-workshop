/**
 * TASK-003: Build Ashtanga Knowledge Graph in Neo4j
 * 
 * Node Schema:
 * - Series { name, description }
 * - Asana { name, sanskritName, subject, actions[], goal }
 * - Tag { name, category }
 * 
 * Relationships:
 * - (Series)-[:CONTAINS]->(Asana)
 * - (Asana)-[:REQUIRES {action: 'tag'}]->(Tag)
 * - (Asana)-[:ENABLES]->(Asana) - next asana in sequence
 * - (Tag)-[:USED_IN]->(Asana)
 * - (Asana)-[:LEADS_TO]->(Series) - progression to next series
 */

const neo4j = require('neo4j-driver');
require('dotenv').config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

const session = driver.session();

// ============ SERIES DATA ============
const seriesData = [
  {
    name: 'Primary Series',
    sanskritName: 'Ardha Chandrasana',
    description: 'Yoga Chikitsa - detoxifying and aligning the body'
  },
  {
    name: 'Intermediate Series',
    sanskritName: 'Nadi Shodhana',
    description: 'Purifying the nervous system and energy channels'
  },
  {
    name: 'Advance A',
    sanskritName: 'Sankhachalan',
    description: 'Deep hip and spine opening, arm balances'
  },
  {
    name: 'Advance B',
    sanskritName: 'Bhu Parsvakritya',
    description: 'Advanced arm balances and inversions'
  }
];

// ============ ASANA DATA (from Obsidian vault) ============
const asanaData = [
  // PRIMARY SERIES - Standing + Finishing
  { name: 'Suryanamaskara A', series: 'Primary Series', subject: 'Warmup', actions: ['sunSalutation'], goal: 'Warm up body and mind' },
  { name: 'Suryanamaskara B', series: 'Primary Series', subject: 'Warmup', actions: ['sunSalutation'], goal: 'Build heat and energy' },
  { name: 'Padahastasana', series: 'Primary Series', subject: 'Standing', actions: ['forwardBend', 'hamstring'], goal: 'Forward fold from standing' },
  { name: 'Utthita Trikonasana', series: 'Primary Series', subject: 'Standing', actions: ['sidebend', 'balance', 'legStrength'], goal: 'Side body extension' },
  { name: 'Pascimattanasana', series: 'Primary Series', subject: 'Seated Forward Bend', actions: ['forwardBend'], goal: 'Core seated forward bend' },
  { name: 'Purvattanasana', series: 'Primary Series', subject: 'Seated', actions: ['shoulderExtension', 'coreStrength', 'bandha'], goal: 'Shoulder extension with core' },
  { name: 'Ardha Buddha Padma Pascimattanasana', series: 'Primary Series', subject: 'Seated', actions: ['forwardBend', 'padmasana'], goal: 'Half lotus forward bend' },
  { name: 'Triang Mukha Ekapada Pascimattanasana', series: 'Primary Series', subject: 'Seated', actions: ['legsInternalRotation', 'forwardBend', 'kneeFolding'], goal: 'Three-quarter lotus forward bend' },
  { name: 'Janu Sirsasana A', series: 'Primary Series', subject: 'Seated', actions: ['forwardBend', 'legsExternalRotation', 'kneeFolding'], goal: 'Head-to-knee pose A' },
  { name: 'Janu Sirsasana B', series: 'Primary Series', subject: 'Seated', actions: ['forwardBend', 'legsExternalRotation', 'kneeFolding'], goal: 'Head-to-knee pose B' },
  { name: 'Janu Sirsasana C', series: 'Primary Series', subject: 'Seated', actions: ['forwardBend', 'legsExternalRotation', 'kneeTwisting'], goal: 'Head-to-knee pose C' },
  { name: 'Maricasana A', series: 'Primary Series', subject: 'Seated', actions: ['kneeFolding', 'forwardBend', 'shoulderExtension'], goal: 'Sage pose A' },
  { name: 'Maricasana B', series: 'Primary Series', subject: 'Seated', actions: ['forwardBend', 'padmasana', 'shoulderExtension'], goal: 'Sage pose B' },
  { name: 'Maricasana C', series: 'Primary Series', subject: 'Seated', actions: ['twisting', 'kneeFolding', 'shouldersRotation'], goal: 'Sage pose C' },
  { name: 'Maricasana D', series: 'Primary Series', subject: 'Seated', actions: ['twisting', 'kneeFolding', 'padmasana', 'shouldersRotation'], goal: 'Sage pose D' },
  { name: 'Navasana', series: 'Primary Series', subject: 'Seated Core', actions: ['coreStrength'], goal: 'Boat pose - core strength' },
  { name: 'Bhuja Pidasana', series: 'Primary Series', subject: 'Arm Balance', actions: ['armBalance', 'legsExternalRotation', 'coreStrength', 'bandha'], goal: 'Arm pressure pose' },
  { name: 'Kurmasana', series: 'Primary Series', subject: 'Seated', actions: ['forwardBend', 'coreStrength'], goal: 'Tortoise pose' },
  { name: 'Supta Kurmasana', series: 'Primary Series', subject: 'Supine', actions: ['forwardBend', 'legsBehindHead', 'coreStrength', 'legsExternalRotation', 'bandha'], goal: 'Sleeping tortoise - legs behind head' },
  { name: 'Garbha Pindasana', series: 'Primary Series', subject: 'Padmasana', actions: ['padmasana', 'coreStrength', 'bandha'], goal: 'Embryo pose in lotus' },
  { name: 'Kukutasana', series: 'Primary Series', subject: 'Arm Balance', actions: ['padmasana', 'armBalance', 'coreStrength', 'bandha'], goal: 'Cockerel pose - arm balance in lotus' },
  { name: 'Buddha Konasana', series: 'Primary Series', subject: 'Seated', actions: ['legsExternalRotation', 'forwardBend', 'kneeFolding'], goal: 'Bound angle pose' },
  { name: 'Upavishtha Konasana', series: 'Primary Series', subject: 'Seated', actions: ['legSplit', 'forwardBend', 'coreStrength', 'balance'], goal: 'Wide-angle seated forward bend' },
  { name: 'Supta Konasana', series: 'Primary Series', subject: 'Supine', actions: ['forwardBend', 'shoulderstand', 'coreStrength', 'balance'], goal: 'Reclined bound angle' },
  { name: 'Supta Padangushthasana', series: 'Primary Series', subject: 'Supine', actions: ['legSplit', 'legsExternalRotation'], goal: 'Reclined big toe pose' },
  { name: 'Upbhaya Padangushthasana', series: 'Primary Series', subject: 'Inverted', actions: ['forwardBend', 'shoulderstand', 'coreStrength'], goal: 'Unsupported leg behind head' },
  { name: 'Urdhva Mukha Pascimattanasana', series: 'Primary Series', subject: 'Inverted', actions: ['forwardBend', 'shoulderstand'], goal: 'Face-up forward bend from shoulderstand' },
  { name: 'Setu Bandhasana', series: 'Primary Series', subject: 'Backbend', actions: ['backbend', 'legStrength', 'legsExternalRotation'], goal: 'Bridge pose' },
  
  // FINISHING ASANAS
  { name: 'Urdhva Dhanurasana', series: 'Primary Series', subject: 'Backbend', actions: ['backbend', 'shouldersRotation', 'breathing', 'coreStrength', 'bandha'], goal: 'Upward facing bow' },
  { name: 'Salabangasana', series: 'Primary Series', subject: 'Shoulderstand', actions: ['shoulderstand', 'coreStrength', 'bandha'], goal: 'Locust pose from shoulderstand' },
  { name: 'Halasana', series: 'Primary Series', subject: 'Shoulderstand', actions: ['forwardBend', 'coreStrength', 'shoulderExtension'], goal: 'Plow pose' },
  { name: 'Karna Pidasana', series: 'Primary Series', subject: 'Shoulderstand', actions: ['forwardBend', 'breathing', 'shoulderExtension', 'bandha'], goal: 'Ear pressure pose' },
  { name: 'Urdhva Padmasana', series: 'Primary Series', subject: 'Shoulderstand', actions: ['padmasana', 'shoulderstand', 'coreStrength', 'balance'], goal: 'Lotus in shoulderstand' },
  { name: 'Pindasana', series: 'Primary Series', subject: 'Shoulderstand', actions: ['balance', 'padmasana', 'shoulderstand'], goal: 'Embryo pose in shoulderstand' },
  { name: 'Matsyasana', series: 'Primary Series', subject: 'Backbend', actions: ['padmasana', 'backbend', 'bandha', 'breathing'], goal: 'Fish pose - opens throat' },
  { name: 'Utthana Padasana', series: 'Primary Series', subject: 'Backbend', actions: ['backbend', 'coreStrength', 'bandha'], goal: 'Raised leg pose' },
  { name: 'Sirsasana', series: 'Primary Series', subject: 'Headstand', actions: ['headstand', 'shoulders', 'balance', 'bandha'], goal: 'King of asanas - headstand' },
  { name: 'Buddha Padmasana', series: 'Primary Series', subject: 'Lotus', actions: ['padmasana'], goal: 'Seated lotus for breathing' },
  { name: 'Yoga Mudra', series: 'Primary Series', subject: 'Lotus', actions: ['padmasana', 'breathing', 'forwardBend'], goal: 'Symbolic gesture - sealing practice' },
  { name: 'Padmasana', series: 'Primary Series', subject: 'Lotus', actions: ['padmasana', 'breathing'], goal: 'Full lotus for meditation' },
  { name: 'Utplutih', series: 'Primary Series', subject: 'Arm Balance', actions: ['breathing', 'bandha', 'padmasana', 'armBalance', 'shoulders'], goal: 'Floating lotus arm balance' },

  // Vinyasa elements (shared across series)
  { name: 'Jump Back', series: 'Vinyasa', subject: 'Transition', actions: ['jumpBack', 'coreStrength', 'bandha'], goal: 'Jump from seated to plank' },
  { name: 'Jump Through', series: 'Vinyasa', subject: 'Transition', actions: ['jumpThrough', 'coreStrength', 'bandha', 'hamstring'], goal: 'Jump through arms to seated' },
  { name: 'Chaturanga', series: 'Vinyasa', subject: 'Transition', actions: ['chaturanga', 'coreStrength', 'armStrength', 'shoulders'], goal: 'Low plank - shoulder strength' },
  { name: 'Upward Dog', series: 'Vinyasa', subject: 'Transition', actions: ['upwardDog', 'backbend', 'shoulderExtension'], goal: 'Backbend in vinyasa' },
  { name: 'Down Dog', series: 'Vinyasa', subject: 'Transition', actions: ['downDog', 'forwardBend', 'hamstring', 'shoulderExtension'], goal: 'Inversion - rest pose' },

  // INTERMEDIATE SERIES
  { name: 'Pashasana', series: 'Intermediate Series', subject: 'Seated Twist', actions: ['twisting', 'squat', 'bandha'], goal: 'Noose pose - deep twist' },
  { name: 'Krounchasana', series: 'Intermediate Series', subject: 'Seated', actions: ['forwardBend', 'kneeFolding', 'legsInternalRotation'], goal: 'Heron pose' },
  { name: 'Shalabhasana A', series: 'Intermediate Series', subject: 'Prone Backbend', actions: ['backbend', 'coreStrength', 'bandha'], goal: 'Locust A' },
  { name: 'Shalabhasana B', series: 'Intermediate Series', subject: 'Prone Backbend', actions: ['backbend', 'coreStrength', 'bandha'], goal: 'Locust B' },
  { name: 'Bhekasana', series: 'Intermediate Series', subject: 'Prone Backbend', actions: ['backbend', 'kneeFolding', 'coreStrength', 'legsInternalRotation'], goal: 'Frog pose - backbend with knee fold' },
  { name: 'Dhanurasana', series: 'Intermediate Series', subject: 'Prone Backbend', actions: ['backbend', 'shoulders', 'shoulderExtension', 'bandha'], goal: 'Bow pose - full backbend' },
  { name: 'Parsvadhanurasana', series: 'Intermediate Series', subject: 'Standing Backbend', actions: ['backbend', 'bandha', 'shoulders', 'coreStrength', 'shoulderExtension'], goal: 'Side bow pose' },
  { name: 'Ustrasana', series: 'Intermediate Series', subject: 'Kneeling Backbend', actions: ['backbend', 'shoulderExtension'], goal: 'Camel pose' },
  { name: 'Laghu Vajrasana', series: 'Intermediate Series', subject: 'Kneeling Backbend', actions: ['backbend', 'legStrength', 'coreStrength', 'shoulderExtension', 'bandha'], goal: 'Little thunderbolt - intense backbend' },
  { name: 'Kapotasana', series: 'Intermediate Series', subject: 'Kneeling Backbend', actions: ['backbend', 'shouldersRotation', 'extremeBackbend', 'bandha'], goal: 'Dove pose - deep backbend' },
  { name: 'Supta Vajrasana', series: 'Intermediate Series', subject: 'Supine', actions: ['backbend', 'padmasana', 'shoulders', 'bandha'], goal: 'Sleeping thunderbolt' },
  { name: 'Bakasana A', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['bandha', 'armBalance', 'coreStrength', 'armStrength'], goal: 'Crow A - foundation arm balance' },
  { name: 'Bakasana B', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['bandha', 'armBalance', 'coreStrength', 'armStrength'], goal: 'Crow B' },
  { name: 'Bharadvajasana', series: 'Intermediate Series', subject: 'Seated Twist', actions: ['twisting', 'padmasana', 'legsInternalRotation'], goal: 'Sage Bharadvaja twist' },
  { name: 'Ardha Matsyendraasana', series: 'Intermediate Series', subject: 'Seated Twist', actions: ['twisting', 'hip', 'kneeFolding'], goal: 'Half lord of fishes - deep twist' },
  { name: 'Ekapada Sirsasana', series: 'Intermediate Series', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'forwardBend', 'coreStrength', 'bandha'], goal: 'One foot behind head' },
  { name: 'Dwipada Sirsasana', series: 'Intermediate Series', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'legsExternalRotation', 'forwardBend', 'bandha', 'coreStrength'], goal: 'Two feet behind head' },
  { name: 'Yoga Nidrasana', series: 'Intermediate Series', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'forwardBend', 'legsExternalRotation'], goal: 'Yoga sleep - full expression' },
  { name: 'Tittibhasana A', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['forwardBend', 'bandha', 'legsExternalRotation', 'coreStrength', 'balance', 'legStrength'], goal: 'Firefly A' },
  { name: 'Tittibhasana B', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['forwardBend', 'bandha', 'legsExternalRotation', 'coreStrength', 'balance', 'legStrength'], goal: 'Firefly B' },
  { name: 'Tittibhasana C', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['forwardBend', 'bandha', 'legsExternalRotation', 'coreStrength', 'balance', 'legStrength'], goal: 'Firefly C' },
  { name: 'Tittibhasana D', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['forwardBend', 'bandha', 'legsExternalRotation', 'coreStrength', 'balance', 'legStrength'], goal: 'Firefly D' },
  { name: 'Pincha Mayurasana', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['armBalance', 'shouldersRotation', 'coreStrength', 'balance', 'upsideDown'], goal: 'Peacock tail - forearm stand' },
  { name: 'Karandavasana', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['padmasana', 'armBalance', 'shouldersRotation', 'coreStrength', 'balance', 'bandha', 'upsideDown'], goal: 'Himalayan goose - lotus in forearm stand' },
  { name: 'Mayurasana', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['armStrength', 'bandha', 'armBalance', 'biceps', 'shoulders', 'coreStrength'], goal: 'Peacock pose - pure arm strength' },
  { name: 'Nakrasana', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['coreStrength'], goal: 'Crocodile pose' },
  { name: 'Vatayanasana', series: 'Intermediate Series', subject: 'Arm Balance', actions: ['padmasana', 'balance', 'shouldersRotation', 'bandha'], goal: 'Horse face pose' },
  { name: 'Parighasana', series: 'Intermediate Series', subject: 'Seated', actions: ['legSplit', 'stretching', 'kneeFolding', 'shouldersRotation'], goal: 'Iron bar pose' },
  { name: 'Gomukhasana A', series: 'Intermediate Series', subject: 'Seated', actions: ['kneeFolding', 'coreStrength', 'shouldersRotation', 'hip'], goal: 'Cow face A' },
  { name: 'Gomukhasana B', series: 'Intermediate Series', subject: 'Seated', actions: ['kneeFolding', 'coreStrength', 'shouldersRotation', 'hip'], goal: 'Cow face B' },
  { name: 'Supta Urdhva Pada Vajrasana A', series: 'Intermediate Series', subject: 'Supine', actions: ['padmasana', 'kneeFolding', 'twisting', 'shouldersRotation', 'coreStrength', 'upsideDown'], goal: 'Sleeping elevated thunderbolt A' },
  { name: 'Supta Urdhva Pada Vajrasana B', series: 'Intermediate Series', subject: 'Supine', actions: ['padmasana', 'kneeFolding', 'twisting', 'shouldersRotation', 'coreStrength', 'upsideDown'], goal: 'Sleeping elevated thunderbolt B' },
  { name: 'Mukta Hasta Sirsasana A', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shoulders', 'coreStrength', 'upsideDown'], goal: 'Open hand headstand A' },
  { name: 'Mukta Hasta Sirsasana B', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shoulders', 'coreStrength', 'upsideDown'], goal: 'Open hand headstand B' },
  { name: 'Mukta Hasta Sirsasana C', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shoulders', 'coreStrength', 'upsideDown'], goal: 'Open hand headstand C' },
  { name: 'Baddha Hasta Sirsasana A', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shouldersRotation', 'coreStrength', 'upsideDown'], goal: 'Bound hand headstand A' },
  { name: 'Baddha Hasta Sirsasana B', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shouldersRotation', 'coreStrength', 'upsideDown'], goal: 'Bound hand headstand B' },
  { name: 'Baddha Hasta Sirsasana C', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shouldersRotation', 'coreStrength', 'upsideDown'], goal: 'Bound hand headstand C' },
  { name: 'Baddha Hasta Sirsasana D', series: 'Intermediate Series', subject: 'Headstand', actions: ['headstand', 'shouldersRotation', 'coreStrength', 'upsideDown'], goal: 'Bound hand headstand D' },

  // ADVANCE A
  { name: 'Vishvamistrasana', series: 'Advance A', subject: 'Arm Balance', actions: ['sidePlank', 'shoulders', 'coreStrength'], goal: 'Side plank variation' },
  { name: 'Vasistasana', series: 'Advance A', subject: 'Arm Balance', actions: ['sidePlank', 'shoulders', 'coreStrength'], goal: 'Side plank full expression' },
  { name: 'Kasayapasana', series: 'Advance A', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'legsExternalRotation', 'coreStrength'], goal: 'Leg behind head with arm balance' },
  { name: 'Chakorasana', series: 'Advance A', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'legsExternalRotation', 'liftingBody', 'coreStrength'], goal: 'Wheel pose with leg behind head' },
  { name: 'Biaravasana', series: 'Advance A', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'legsExternalRotation', 'sidePlank', 'coreStrength'], goal: 'Leg behind head side plank' },
  { name: 'Skandasana', series: 'Advance A', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'legsExternalRotation', 'forwardBend', 'coreStrength'], goal: 'Deep forward bend with leg behind' },
  { name: 'Durvasana', series: 'Advance A', subject: 'Leg Behind Head', actions: ['legsBehindHead', 'legsExternalRotation', 'balance', 'coreStrength'], goal: 'Durva sage pose' },
  { name: 'Urdhva Kukutasana A', series: 'Advance A', subject: 'Arm Balance', actions: ['bandha', 'shoulders', 'coreStrength', 'padmasana', 'armBalance', 'headstand', 'upsideDown'], goal: 'Upward cockerel A' },
  { name: 'Urdhva Kukutasana B', series: 'Advance A', subject: 'Arm Balance', actions: ['bandha', 'shoulders', 'coreStrength', 'padmasana', 'armBalance', 'liftingBody'], goal: 'Upward cockerel B' },
  { name: 'Urdhva Kukutasana C', series: 'Advance A', subject: 'Arm Balance', actions: ['bandha', 'shoulders', 'coreStrength', 'padmasana', 'armBalance', 'liftingBody'], goal: 'Upward cockerel C' },
  { name: 'Galavasana', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'legsExternalRotation', 'coreStrength', 'bandha', 'headstand', 'upsideDown'], goal: 'Flying crow - advanced arm balance' },
  { name: 'Ekapada Bakasana A', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'coreStrength', 'bandha', 'headstand', 'upsideDown'], goal: 'One-legged crow A' },
  { name: 'Ekapada Bakasana B', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'coreStrength', 'bandha', 'headstand', 'upsideDown'], goal: 'One-legged crow B' },
  { name: 'Kundinyasana A', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'coreStrength', 'bandha', 'headstand', 'twisting', 'upsideDown'], goal: 'Side crow A' },
  { name: 'Kundinyasana B', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'coreStrength', 'bandha', 'headstand', 'twisting', 'upsideDown'], goal: 'Side crow B' },
  { name: 'Ashtavagasana A', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'coreStrength', 'bandha', 'headstand', 'twisting', 'upsideDown'], goal: 'Eight-angle A' },
  { name: 'Ashtavagasana B', series: 'Advance A', subject: 'Arm Balance', actions: ['armBalance', 'coreStrength', 'bandha', 'headstand', 'twisting'], goal: 'Eight-angle B' },
  { name: 'Purna Matsyendrasana', series: 'Advance A', subject: 'Seated Twist', actions: ['padmasana', 'twisting'], goal: 'Full lord of fishes pose' },
  { name: 'Viranchyasana A', series: 'Advance A', subject: 'Arm Balance', actions: ['padmasana', 'legsBehindHead', 'armBalance', 'bandha', 'liftingBody'], goal: 'Viranchya sage A' },
  { name: 'Viranchyasana B', series: 'Advance A', subject: 'Standing', actions: ['kneeTwisting', 'forwardBend', 'twisting'], goal: 'Viranchya sage B' },
  { name: 'Viparita Dandasana A', series: 'Advance A', subject: 'Inversion', actions: ['backbend', 'headstand', 'balance', 'bandha', 'upsideDown'], goal: 'Inverted staff A' },
  { name: 'Viparita Dandasana B', series: 'Advance A', subject: 'Inversion', actions: ['backbend', 'headstand', 'balance', 'bandha', 'legSplit', 'upsideDown'], goal: 'Inverted staff B' },
  { name: 'Viparita Shalabasana', series: 'Advance A', subject: 'Inversion', actions: ['backbend', 'chinStand', 'balance', 'bandha', 'upsideDown'], goal: 'Inverted locust' },
  { name: 'Ganda Bherundasana', series: 'Advance A', subject: 'Inversion', actions: ['backbend', 'chinStand', 'balance', 'bandha', 'upsideDown'], goal: 'Ganda Bherunda - double bird' },
  { name: 'Hanumanasana', series: 'Advance A', subject: 'Leg Split', actions: ['legSplit', 'forwardBend', 'bandha'], goal: 'Full splits - monkey god' },
  { name: 'Supta Trivikramasana', series: 'Advance A', subject: 'Leg Split', actions: ['legSplit'], goal: 'Reclined three-part pose' },
  { name: 'Digasana', series: 'Advance A', subject: 'Standing', actions: ['forwardBend', 'balance', 'coreStrength'], goal: 'Standing split' },
  { name: 'Trivikramasana', series: 'Advance A', subject: 'Leg Split', actions: ['legSplit', 'balance', 'coreStrength'], goal: 'Three-part leg split' },
  { name: 'Natrajasana', series: 'Advance A', subject: 'Balance', actions: ['balance', 'backbend', 'shoulders', 'bandha', 'shouldersRotation'], goal: 'Lord of dance pose' },
  { name: 'Raja Kapotasana', series: 'Advance A', subject: 'Backbend', actions: ['backbend'], goal: 'King pigeon - deep backbend' },
  { name: 'Ekapada Raja Kapotasana', series: 'Advance A', subject: 'Backbend', actions: ['backbend', 'legSplit', 'shouldersRotation'], goal: 'One-legged king pigeon' },
];

// ============ TAG CATEGORIES ============
const tagCategories = {
  // Body parts
  'forwardBend': 'flexibility',
  'backbend': 'flexibility',
  'twisting': 'mobility',
  'sidebend': 'mobility',
  'legSplit': 'flexibility',
  'hip': 'flexibility',
  
  // Strength
  'coreStrength': 'strength',
  'armStrength': 'strength',
  'armBalance': 'strength',
  'legStrength': 'strength',
  'bandha': 'technique',
  'balance': 'skill',
  
  // Rotation
  'shouldersRotation': 'mobility',
  'legsExternalRotation': 'mobility',
  'legsInternalRotation': 'mobility',
  'shoulderExtension': 'mobility',
  
  // Advanced
  'legsBehindHead': 'advanced',
  'padmasana': 'advanced',
  'headstand': 'inversion',
  'shoulderstand': 'inversion',
  'upsideDown': 'inversion',
  'extremeBackbend': 'advanced',
  
  // Other
  'breathing': 'pranayama',
  'kneeFolding': 'flexibility',
  'kneeTwisting': 'mobility',
  'shoulders': 'strength',
  'squat': 'strength',
  'liftingBody': 'strength',
  'stretching': 'flexibility',
  'sidePlank': 'strength',
  'chinStand': 'advanced',
  
  // Transitions
  'jumpBack': 'vinyasa',
  'jumpThrough': 'vinyasa',
  'chaturanga': 'vinyasa',
  'upwardDog': 'vinyasa',
  'downDog': 'vinyasa',
  'sunSalutation': 'vinyasa',
  'hamstring': 'flexibility',
};

// ============ MAIN IMPORT ============
async function importAshtangaGraph() {
  const writeSession = driver.session();
  
  try {
    console.log('🧘 Building Ashtanga Knowledge Graph...\n');

    // Clear existing data (optional - comment out to append)
    await writeSession.run('MATCH (n) DETACH DELETE n');
    console.log('✓ Cleared existing graph\n');

    // 1. Create Series nodes
    console.log('📦 Creating Series nodes...');
    for (const series of seriesData) {
      await writeSession.run(
        `CREATE (s:Series {
          name: $name,
          sanskritName: $sanskritName,
          description: $description,
          createdAt: datetime()
        })`,
        series
      );
    }
    console.log(`  ✓ Created ${seriesData.length} series nodes\n`);

    // 2. Create all unique Tags
    console.log('🏷️  Creating Tag nodes...');
    const uniqueTags = [...new Set(asanaData.flatMap(a => a.actions))];
    for (const tagName of uniqueTags) {
      await writeSession.run(
        `MERGE (t:Tag {name: $name})
         SET t.category = $category`,
        { name: tagName, category: tagCategories[tagName] || 'general' }
      );
    }
    console.log(`  ✓ Created ${uniqueTags.length} tag nodes\n`);

    // 3. Create Asana nodes and relationships
    console.log('🧘 Creating Asana nodes and relationships...');
    let asanaCount = 0;
    
    for (const asana of asanaData) {
      // Create Asana node
      await writeSession.run(
        `MATCH (s:Series {name: $series})
         CREATE (a:Asana {
           name: $name,
           series: $series,
           subject: $subject,
           actions: $actions,
           goal: $goal,
           createdAt: datetime()
         })
         CREATE (s)-[:CONTAINS]->(a)`,
        asana
      );

      // Create REQUIRES relationships to Tags
      for (const action of asana.actions) {
        await writeSession.run(
          `MATCH (a:Asana {name: $asanaName}), (t:Tag {name: $tagName})
           MERGE (a)-[r:REQUIRES]->(t)
           SET r.action = $tagName`,
          { asanaName: asana.name, tagName: action }
        );
        
        // Also create inverse: Tag USED_IN Asana
        await writeSession.run(
          `MATCH (t:Tag {name: $tagName}), (a:Asana {name: $asanaName})
           MERGE (t)-[:USED_IN]->(a)`,
          { tagName: action, asanaName: asana.name }
        );
      }

      asanaCount++;
      if (asanaCount % 10 === 0) {
        console.log(`  📍 Processed ${asanaCount}/${asanaData.length} asanas...`);
      }
    }
    console.log(`  ✓ Created ${asanaCount} asana nodes with tag relationships\n`);

    // 4. Create series progression relationships
    console.log('🔗 Creating series progression...');
    const progressions = [
      { from: 'Primary Series', to: 'Intermediate Series' },
      { from: 'Intermediate Series', to: 'Advance A' },
      { from: 'Advance A', to: 'Advance B' },
    ];
    
    for (const prog of progressions) {
      await writeSession.run(
        `MATCH (from:Series {name: $from}), (to:Series {name: $to})
         CREATE (from)-[:LEADS_TO]->(to)`,
        prog
      );
    }
    console.log('  ✓ Created series progression paths\n');

    // 5. Create tag-to-tag relationships (skills that support each other)
    console.log('🔄 Creating tag support relationships...');
    const tagSupports = [
      { tag: 'coreStrength', supports: ['bandha', 'armBalance', 'balance'] },
      { tag: 'bandha', supports: ['breathing', 'headstand', 'upsideDown'] },
      { tag: 'legsExternalRotation', supports: ['padmasana', 'legsBehindHead', 'kneeFolding'] },
      { tag: 'legsInternalRotation', supports: ['kneeFolding'] },
      { tag: 'shouldersRotation', supports: ['shoulderExtension', 'backbend'] },
      { tag: 'forwardBend', supports: ['hamstring', 'legSplit'] },
      { tag: 'kneeFolding', supports: ['padmasana', 'legsBehindHead'] },
    ];

    for (const { tag, supports } of tagSupports) {
      for (const supported of supports) {
        await writeSession.run(
          `MATCH (t1:Tag {name: $tag}), (t2:Tag {name: $supported})
           MERGE (t1)-[:SUPPORTS]->(t2)`,
          { tag, supported }
        );
      }
    }
    console.log('  ✓ Created tag support network\n');

    // 6. Summary statistics
    console.log('📊 Graph Summary:');
    const stats = await writeSession.run(`
      MATCH (n)
      WITH labels(n)[0] as type, count(n) as count
      RETURN type, count
    `);
    stats.records.forEach(r => console.log(`  ${r.get('type')}: ${r.get('count')}`));

    const relStats = await writeSession.run(`
      MATCH ()-[r]->()
      WITH type(r) as relType, count(r) as count
      RETURN relType, count
    `);
    console.log('\n📊 Relationships:');
    relStats.records.forEach(r => console.log(`  ${r.get('relType')}: ${r.get('count')}`));

    console.log('\n✅ Ashtanga Knowledge Graph complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await writeSession.close();
    await driver.close();
  }
}

importAshtangaGraph();
