import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Intellidoc blue (#3467B1) and cyan (#41B0D6), as used on the run sheet.
const brand: MantineColorsTuple = ['#eef4fc', '#d9e5f5', '#b3c9ea', '#8aaddf', '#6694d6', '#4d82cf', '#3467b1', '#2c5898', '#244a80', '#1c3b66'];
const cyan: MantineColorsTuple = ['#e6f7fc', '#cdeef8', '#9cdcf0', '#67c9e8', '#41b0d6', '#2c9bc2', '#2488a9', '#1c7390', '#145e78', '#0c4960'];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand, cyan },
  primaryShade: 6,
  fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, sans-serif',
  headings: { fontFamily: 'Poppins, system-ui, sans-serif', fontWeight: '600' },
  defaultRadius: 'md',
});
