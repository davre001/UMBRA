import nextra from 'nextra';

const withNextra = nextra({
  defaultShowCopyCode: true,
});

export default withNextra({
  turbopack: {
    // Nextra resolves the MDX components module through this alias; without it
    // Turbopack fails to find 'next-mdx-import-source-file'.
    resolveAlias: {
      'next-mdx-import-source-file': './mdx-components.tsx',
    },
  },
});
