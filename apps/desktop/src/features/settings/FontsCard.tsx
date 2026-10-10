import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@angkorgit/design-system';
import {
  CODE_FONT_DEFAULT,
  INTERFACE_FONT_DEFAULT,
  TERMINAL_FONT_SIZES,
  cleanFontFamily,
  interfaceFontStack,
  monoFontStack,
} from '@/features/terminal/font';
import { openExternal, type FontFamily } from '@/core/ipc';
import { useSettings } from './store';
import { useInstalledFonts } from './fonts';
import { Field, SettingCard } from './SettingCard';

const PREVIEW = 'git status  ➜  main ✓   λ → ≠ ≥   0O 1lI';
const NERD_FONTS_URL = 'https://www.nerdfonts.com/font-downloads';
const DEFAULT_VALUE = '__default__';

function FontName({ name, stack }: { name: string; stack?: string }) {
  return <span style={{ fontFamily: stack ?? `'${cleanFontFamily(name)}'` }}>{name}</span>;
}

function isMissing(value: string, fonts: FontFamily[], loading: boolean): boolean {
  return !loading && value.trim().length > 0 && !fonts.some((font) => font.family === value);
}

function FontSelect({
  value,
  onChange,
  fonts,
  loading,
  monospaceFirst,
  defaultFamily,
  defaultStack,
  defaultLabel,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (family: string) => void;
  fonts: FontFamily[];
  loading: boolean;
  monospaceFirst: boolean;
  defaultFamily: string;
  defaultStack: string;
  defaultLabel: string;
  ariaLabel: string;
  className?: string;
}) {
  const listed = fonts.filter((font) => font.family !== defaultFamily);
  const monospace = listed.filter((font) => font.monospaced).map((font) => font.family);
  const others = listed.filter((font) => !font.monospaced).map((font) => font.family);
  const groups: Array<[string, string[]]> = monospaceFirst
    ? [
        ['Monospace', monospace],
        ['Other fonts', others],
      ]
    : [
        ['Fonts', others],
        ['Monospace', monospace],
      ];
  const missing = isMissing(value, fonts, loading);
  return (
    <Select value={value || DEFAULT_VALUE} onValueChange={(next) => onChange(next === DEFAULT_VALUE ? '' : next)} disabled={loading}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue placeholder="Reading installed fonts…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_VALUE}>
          <FontName name={defaultFamily} stack={defaultStack} /> <span className="text-faint">({defaultLabel})</span>
        </SelectItem>
        {missing && (
          <SelectItem value={value}>
            {value} <span className="text-faint">(not installed)</span>
          </SelectItem>
        )}
        {groups.map(([label, names]) =>
          names.length === 0 ? null : (
            <SelectGroup key={label}>
              <SelectSeparator />
              <SelectLabel>{label}</SelectLabel>
              {names.map((name) => (
                <SelectItem key={name} value={name}>
                  <FontName name={name} />
                </SelectItem>
              ))}
            </SelectGroup>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

export function FontsCard() {
  const interfaceFamily = useSettings((s) => s.interfaceFontFamily);
  const codeFamily = useSettings((s) => s.codeFontFamily);
  const terminalFamily = useSettings((s) => s.terminalFontFamily);
  const size = useSettings((s) => s.terminalFontSize);
  const setInterfaceFamily = useSettings((s) => s.setInterfaceFontFamily);
  const setCodeFamily = useSettings((s) => s.setCodeFontFamily);
  const setTerminalFamily = useSettings((s) => s.setTerminalFontFamily);
  const setSize = useSettings((s) => s.setTerminalFontSize);
  const resetFonts = useSettings((s) => s.resetFonts);
  const { fonts, loading } = useInstalledFonts();
  const customized = Boolean(interfaceFamily || codeFamily || terminalFamily);
  const codeEffective = codeFamily || CODE_FONT_DEFAULT;
  const missingHint = (value: string, fallback: string) =>
    isMissing(value, fonts, loading) ? (
      <span className="text-danger">Not installed here, using {fallback}</span>
    ) : undefined;

  return (
    <SettingCard
      settingId="fonts"
      title="Fonts"
      description={
        <>
          Pick any font installed on this computer. Interface is the whole app, Code is diffs, hashes and commit
          details, and the terminal follows Code unless you give it its own. Want glyphs? Install one from{' '}
          <a
            href={NERD_FONTS_URL}
            className="whitespace-nowrap text-primary hover:underline"
            onClick={(e) => {
              e.preventDefault();
              void openExternal(NERD_FONTS_URL);
            }}
          >
            Nerd Fonts
          </a>
          .
        </>
      }
      action={
        customized ? (
          <Button variant="ghost" size="sm" onClick={resetFonts}>
            Reset fonts
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Interface" hint={missingHint(interfaceFamily, INTERFACE_FONT_DEFAULT) ?? 'Menus, lists and dialogs'}>
          <FontSelect
            ariaLabel="Interface font"
            value={interfaceFamily}
            onChange={setInterfaceFamily}
            fonts={fonts}
            loading={loading}
            monospaceFirst={false}
            defaultFamily={INTERFACE_FONT_DEFAULT}
            defaultStack={interfaceFontStack('')}
            defaultLabel="default"
          />
        </Field>
        <Field label="Code" hint={missingHint(codeFamily, CODE_FONT_DEFAULT) ?? 'Diffs, hashes and commit details'}>
          <FontSelect
            ariaLabel="Code font"
            value={codeFamily}
            onChange={setCodeFamily}
            fonts={fonts}
            loading={loading}
            monospaceFirst
            defaultFamily={CODE_FONT_DEFAULT}
            defaultStack={monoFontStack('')}
            defaultLabel="default"
          />
        </Field>
        <Field label="Terminal" hint={missingHint(terminalFamily, codeEffective)}>
          <div className="flex gap-2">
            <FontSelect
              ariaLabel="Terminal font"
              className="min-w-0 flex-1"
              value={terminalFamily}
              onChange={setTerminalFamily}
              fonts={fonts}
              loading={loading}
              monospaceFirst
              defaultFamily={codeEffective}
              defaultStack={monoFontStack(codeFamily)}
              defaultLabel="same as Code"
            />
            <Select value={String(size)} onValueChange={(value) => setSize(Number(value))}>
              <SelectTrigger className="w-24 shrink-0" aria-label="Terminal font size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TERMINAL_FONT_SIZES.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>
        <div
          data-terminal-font-preview
          aria-hidden
          className="overflow-hidden whitespace-nowrap rounded-md border border-border-subtle bg-surface-raised/50 px-3 py-2 text-foreground"
          style={{ fontFamily: monoFontStack(terminalFamily || codeFamily), fontSize: size }}
        >
          {PREVIEW}
        </div>
      </div>
    </SettingCard>
  );
}
