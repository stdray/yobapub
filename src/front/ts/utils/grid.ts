import { CARDS_PER_ROW } from '../settings';

interface GridPos {
  col: number;
  row: number;
  totalRows: number;
}

export const gridPos = (index: number, totalItems: number): GridPos => ({
  col: index % CARDS_PER_ROW,
  row: Math.floor(index / CARDS_PER_ROW),
  totalRows: Math.ceil(totalItems / CARDS_PER_ROW)
});

export const gridMove = (index: number, totalItems: number, dir: 'up' | 'down' | 'left' | 'right'): number => {
  const g = gridPos(index, totalItems);
  switch (dir) {
    case 'right':
      if (index < totalItems - 1 && g.col < CARDS_PER_ROW - 1) return index + 1;
      return -1;
    case 'left':
      if (g.col > 0) return index - 1;
      return -1;
    case 'down':
      if (g.row < g.totalRows - 1) return Math.min((g.row + 1) * CARDS_PER_ROW + g.col, totalItems - 1);
      return -1;
    case 'up':
      if (g.row > 0) return (g.row - 1) * CARDS_PER_ROW + g.col;
      return -1;
  }
};
