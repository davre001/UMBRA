import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs';
import { Callout, Cards, Tabs } from 'nextra/components';

const themeComponents = getThemeComponents();

export function useMDXComponents(components?: Record<string, unknown>) {
  return {
    ...themeComponents,
    Callout,
    Cards,
    Tabs,
    ...components,
  };
}
