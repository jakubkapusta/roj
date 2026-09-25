import type { Level } from '../level';
import type { BiomeId } from '../biomes';
import { genSciolka } from './sciolka';
import { genStaw } from './staw';
import { genKorony } from './korony';
import { genBurza } from './burza';
import { genNiebo } from './niebo';

export const GENERATORS: Record<BiomeId, (L: Level) => void> = {
  sciolka: genSciolka,
  staw: genStaw,
  korony: genKorony,
  burza: genBurza,
  niebo: genNiebo,
};
