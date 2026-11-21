(function () {
  if (!window.mermaid) return;

  mermaid.initialize({
    startOnLoad: true,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily: '"Instrument Sans","Microsoft YaHei","PingFang SC",sans-serif',
    themeVariables: {
      primaryColor: '#fbfaf6',
      primaryTextColor: '#16202a',
      primaryBorderColor: '#0d5c8a',
      lineColor: '#0d5c8a',
      secondaryColor: '#e7eef3',
      tertiaryColor: '#efece3',
      fontSize: '15px'
    },
    flowchart: {
      curve: 'basis',
      padding: 18,
      nodeSpacing: 42,
      rankSpacing: 52,
      htmlLabels: true
    }
  });
})();
