declare module 'dot' {
  interface TemplateSettings {
    evaluate: RegExp;
    interpolate: RegExp;
    encode: RegExp;
    use: RegExp;
    define: RegExp;
    conditional: RegExp;
    iterate: RegExp;
    varname: string;
    strip: boolean;
    append: boolean;
  }
  interface DoT {
    templateSettings: TemplateSettings;
    template(tmpl: string, c?: Partial<TemplateSettings>, def?: Record<string, unknown>): (data: unknown) => string;
  }
  const doT: DoT;
  export = doT;
}
