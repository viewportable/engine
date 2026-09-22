const acceptancePlugin = {
  postcssPlugin: 'viewportable-source-map-acceptance',
  Declaration(declaration) {
    if (declaration.prop === 'user-select') {
      declaration.cloneBefore({
        prop: '-webkit-user-select',
        value: declaration.value,
      });
    }
  },
};

export default {
  plugins: [acceptancePlugin],
};
