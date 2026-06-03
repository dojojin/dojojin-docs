import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'DOJOJIN Docs',
  description: 'Engineering docs & project references',
  lang: 'en-US',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Projects', link: '/projects/' },
      { text: 'Guides', link: '/guides/' },
      { text: 'dojojin.tech', link: 'https://dojojin.tech' }
    ],
    sidebar: {
      '/projects/': [
        {
          text: 'Projects',
          items: [
            { text: 'Overview', link: '/projects/' },
            { text: 'Vigil Platform', link: '/projects/vigil-platform' },
            { text: 'AI OCR Pipeline', link: '/projects/ai-ocr-pipeline' }
          ]
        }
      ],
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Overview', link: '/guides/' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/dojojin' }
    ],
    footer: {
      message: 'DOJOJIN.TECH — Engineering Portfolio'
    }
  }
})
