import {
  createI18n,
  FormattedNumber,
  I18nProvider,
  LocaleSwitcher,
  Trans,
  useI18n,
} from "@shadow-js/i18n";

const i18n = createI18n({
  defaultLocale: "en",
  locales: ["en", "fr"],
  messages: {
    en: {
      terms: "Read <b>the terms</b> and <a>privacy</a>",
      hello: "Hello {name}",
      plain: "Plain",
      mixed: "Hi {name}, <b>welcome</b>",
    },
  },
});

declare module "@shadow-js/i18n" {
  interface Register {
    i18n: typeof i18n;
  }
}

function Page() {
  const { t, setLocale } = useI18n();
  t("hello", { name: "x" });
  // @ts-expect-error registered keys are checked
  t("nope");
  void setLocale("fr");
  // @ts-expect-error registered locales are checked
  void setLocale("de");
  return (
    <div>
      <Trans
        key="terms"
        components={{ b: (c) => <strong>{c}</strong>, a: (c) => <a href="/p">{c}</a> }}
      />
      <Trans key="hello" values={{ name: "x" }} />
      <Trans key="plain" />
      <Trans key="mixed" values={{ name: () => "x" }} components={{ b: (c) => <b>{c}</b> }} />
      {/* @ts-expect-error unknown key */}
      <Trans key="missing" />
      {/* @ts-expect-error missing tag handler */}
      <Trans key="terms" components={{ b: (c) => <b>{c}</b> }} />
      {/* @ts-expect-error missing values */}
      <Trans key="hello" />
      {/* @ts-expect-error wrong value name */}
      <Trans key="hello" values={{ nam: "x" }} />
      <FormattedNumber value={1} format="percent" />
      <FormattedNumber value={1} format={{ style: "currency", currency: "EUR" }} />
      {/* @ts-expect-error value must be a number */}
      <FormattedNumber value="1" />
      <LocaleSwitcher>
        {(api) => (
          <button type="button" onClick={() => api.select("fr")}>
            {api.options.length}
          </button>
        )}
      </LocaleSwitcher>
    </div>
  );
}

export function App() {
  return (
    <I18nProvider i18n={i18n}>
      <Page />
    </I18nProvider>
  );
}
