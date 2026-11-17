import treeloom from 'treeloom'
import treeloomMatrix from 'treeloom-matrix'
import siFunciona from 'si-funciona'
import type { Point } from 'treeloom-matrix/dist/point/types'
import type { Player } from '../types'

/**
 * A cell the density model weighs, and how strongly (0 to 1, relative to the top score). The robots aim with it, and
 * a human's sensor scan shows it (attack/heatHint.ts).
 */
export interface HeatCell {
  point: Point
  intensity: number
}

/**
 * A faint yellow for the weakest cells up to a solid one for the strongest, so the spread of the scores shows.
 * @param intensity
 */
export const shade = (intensity: number): string => `rgba(255, 215, 0, ${0.15 + 0.85 * intensity})`

/**
 * Colour one cell's border (the sensor scan's shading, or back to normal).
 * @param victim
 * @param point
 * @param color
 */
export const paint = (victim: Player, point: Point, color: string): void => {
  treeloom.updateElement(siFunciona.mergeObjectsMutable(treeloomMatrix.getDomItemFromPoint(point, victim.board), { attributes: { style: { borderColor: color } } }))
}
