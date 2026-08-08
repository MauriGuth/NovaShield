// Declaraciones para los imports de CSS del target web del template.
// (`expo start` las genera en expo-env.d.ts, pero ese archivo no se versiona;
// esto permite correr `tsc --noEmit` en CI sin arrancar Expo.)
declare module '*.module.css' {
  const styles: { [className: string]: string };
  export default styles;
}
declare module '*.css';
