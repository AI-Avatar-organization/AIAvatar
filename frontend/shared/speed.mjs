/**
 * Movement speeds and Flash Speed (spec R8.5, T27): the one place that says how much faster Flash is.
 * Flash multiplies translation (WASD, flight, landing, auto-walk trips, Follow's catch-up), never turning.
 */
export const FLASH = 3;
export const WALK_SPEED = 1.35;       // m/s: auto-walk on short trips
export const MAX_TRIP_SECONDS = 15;   // long trips speed up so a walk across the whole Map stays short
export const MAX_SPEED = 12;          // m/s: the cap of that speed-up

export const flashed = (speed, flash) => (flash ? speed * FLASH : speed);

/** Auto-walk speed for a trip of `distance` metres (walkTo). */
export function tripSpeed(distance, flash = false) {
  return flashed(Math.min(Math.max(distance / MAX_TRIP_SECONDS, WALK_SPEED), MAX_SPEED), flash);
}
