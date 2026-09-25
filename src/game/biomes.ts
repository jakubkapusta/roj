// The five biomes of a run: look, weather, length and which generator builds them.

export type V3 = [number, number, number];

export type BiomeId = 'sciolka' | 'staw' | 'korony' | 'burza' | 'niebo';

export type BiomeDef = {
  id: BiomeId;
  name: string;
  lead: string;
  threats: string[];
  height: number;
  wallStyle: 'bark' | 'reeds' | 'clouds';
  backdrop: 'forest' | 'reeds' | 'canopy' | 'clouds';
  pal: {
    bot: V3;
    top: V3;
    fogCol: V3;
    solid: V3;
    solidAmb: number;
    rim: number;
    layers: [V3, V3, V3];
    layerFog: [number, number, number];
    lift: V3;
    sat: number;
    fogAmt: number;
    /** moonlight from above on silhouettes (0 = none) */
    topLight: V3;
  };
  /** Moon brightness through the whole biome (the clearing at the end always shows it). */
  moon: number;
  stars: number;
  aurora: number;
  wind: number;
  rain: boolean;
  shadowBase: number;
  shadowRamp: number;
};

export const BIOMES: BiomeDef[] = [
  {
    id: 'sciolka',
    name: 'Ściółka',
    lead: 'Dno lasu. Grzyby świecą, a w ciemności czekają pajęczyny.',
    threats: ['Pajęczyny', 'Nietoperze', 'Cień'],
    height: 14000,
    wallStyle: 'bark',
    backdrop: 'forest',
    pal: {
      bot: [0.0006, 0.0018, 0.0025],
      top: [0.003, 0.009, 0.015],
      fogCol: [0.005, 0.013, 0.02],
      solid: [0.014, 0.02, 0.018],
      solidAmb: 0.6,
      rim: 1.6,
      layers: [[0.012, 0.026, 0.036], [0.008, 0.017, 0.022], [0.005, 0.01, 0.011]],
      layerFog: [0.55, 0.35, 0.12],
      lift: [0, 0.004, 0.009],
      sat: 1.1,
      topLight: [0, 0, 0],
      fogAmt: 1,
    },
    moon: 0,
    stars: 0,
    aurora: 0,
    wind: 1,
    rain: false,
    shadowBase: 36,
    shadowRamp: 22,
  },
  {
    id: 'staw',
    name: 'Staw',
    lead: 'Trzciny we mgle nad czarną wodą. Żaby nie śpią.',
    threats: ['Żaby', 'Ważki', 'Gęsta mgła'],
    height: 14000,
    wallStyle: 'reeds',
    backdrop: 'reeds',
    pal: {
      bot: [0.001, 0.004, 0.005],
      top: [0.005, 0.017, 0.022],
      fogCol: [0.012, 0.03, 0.034],
      solid: [0.01, 0.02, 0.017],
      solidAmb: 0.7,
      rim: 1.5,
      layers: [[0.02, 0.045, 0.05], [0.012, 0.028, 0.03], [0.006, 0.013, 0.013]],
      layerFog: [0.7, 0.5, 0.2],
      lift: [0, 0.006, 0.008],
      sat: 1.05,
      topLight: [0.004, 0.009, 0.011],
      fogAmt: 1.7,
    },
    moon: 0.35,
    stars: 0,
    aurora: 0,
    wind: 1.2,
    rain: false,
    shadowBase: 40,
    shadowRamp: 22,
  },
  {
    id: 'korony',
    name: 'Korony',
    lead: 'Wysoko w gałęziach księżyc przebija liście. Uważaj na sowę.',
    threats: ['Sowa', 'Podmuchy wiatru', 'Nietoperze'],
    height: 15000,
    wallStyle: 'bark',
    backdrop: 'canopy',
    pal: {
      bot: [0.001, 0.0015, 0.004],
      top: [0.006, 0.008, 0.026],
      fogCol: [0.008, 0.01, 0.03],
      solid: [0.012, 0.012, 0.02],
      solidAmb: 0.6,
      rim: 1.7,
      layers: [[0.016, 0.018, 0.045], [0.01, 0.011, 0.026], [0.005, 0.005, 0.012]],
      layerFog: [0.55, 0.35, 0.12],
      lift: [0.004, 0.002, 0.012],
      sat: 1.1,
      topLight: [0.006, 0.008, 0.02],
      fogAmt: 1.1,
    },
    moon: 0.65,
    stars: 0.15,
    aurora: 0,
    wind: 1.6,
    rain: false,
    shadowBase: 42,
    shadowRamp: 24,
  },
  {
    id: 'burza',
    name: 'Burza',
    lead: 'Ulewa gasi światło. Chowaj rój pod liśćmi, gdy nadchodzi fala deszczu.',
    threats: ['Deszcz', 'Błyskawice', 'Wiatr'],
    height: 15000,
    wallStyle: 'bark',
    backdrop: 'forest',
    pal: {
      bot: [0.0008, 0.001, 0.0016],
      top: [0.004, 0.005, 0.009],
      fogCol: [0.006, 0.007, 0.011],
      solid: [0.012, 0.013, 0.016],
      solidAmb: 0.6,
      rim: 1.8,
      layers: [[0.012, 0.014, 0.022], [0.008, 0.009, 0.014], [0.004, 0.005, 0.007]],
      layerFog: [0.5, 0.32, 0.12],
      lift: [0.002, 0.003, 0.007],
      sat: 0.85,
      topLight: [0, 0, 0],
      fogAmt: 1.2,
    },
    moon: 0,
    stars: 0,
    aurora: 0,
    wind: 2.4,
    rain: true,
    shadowBase: 44,
    shadowRamp: 24,
  },
  {
    id: 'niebo',
    name: 'Nad chmurami',
    lead: 'Ponad chmurami świecą gwiazdy. Ćmy lecą do każdego światła.',
    threats: ['Ćmy', 'Zimne prądy'],
    height: 11000,
    wallStyle: 'clouds',
    backdrop: 'clouds',
    pal: {
      bot: [0.004, 0.006, 0.02],
      top: [0.0015, 0.002, 0.009],
      fogCol: [0.02, 0.025, 0.06],
      solid: [0.035, 0.042, 0.075],
      solidAmb: 0.9,
      rim: 1.4,
      layers: [[0.035, 0.045, 0.09], [0.026, 0.032, 0.066], [0.018, 0.022, 0.046]],
      layerFog: [0.4, 0.25, 0.1],
      lift: [0.004, 0.004, 0.014],
      sat: 1.1,
      topLight: [0.05, 0.06, 0.11],
      fogAmt: 0.8,
    },
    moon: 1,
    stars: 1,
    aurora: 1,
    wind: 0.6,
    rain: false,
    shadowBase: 46,
    shadowRamp: 20,
  },
];
