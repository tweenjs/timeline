export type CurveNode = {x: number; y: number; ix: number; iy: number; ox: number; oy: number}
export type CurveRow = [x: number, y: number, ix?: number, iy?: number, ox?: number, oy?: number]
export type CurveEasing = ((amount: number) => number) & {nodes: CurveNode[]}

export function cubicBezierNodes(x1: number, y1: number, x2: number, y2: number): CurveNode[]
export function normalizeNodes(nodes: CurveNode[]): CurveNode[]
export function curveEasing(nodes: Array<CurveNode | CurveRow>, samples?: number): CurveEasing
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): CurveEasing
