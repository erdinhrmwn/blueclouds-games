/**
 * The table's stage: a fixed-size screen scaled to fit the window, wide (16:9) on a landscape window and tall (1:2)
 * on a portrait one. `scale` turns stage pixels into screen pixels; outside a table it stays 1.
 */
export const STAGE = {
	wide: { width: 1280, height: 720 },
	tall: { width: 390, height: 780 }
} as const;

export const stage = $state({ wide: true, scale: 1 });

/** A distance measured on screen (getBoundingClientRect) in the stage's own pixels, for transforms inside it. */
export const unscaled = (px: number) => px / stage.scale;
