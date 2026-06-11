import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'DOJOJIN Docs',
  description: 'Engineering docs & project references',
  cleanUrls: true,

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
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
                {
                  text: 'Vigil Platform',
                  items: [
                    { text: 'Platform', link: '/projects/vigil-platform' },
                    { text: 'Mobile App', link: '/projects/vigil-mobile' }
                  ]
                },
                { text: 'AI OCR Pipeline', link: '/projects/ai-ocr-pipeline' },
                { text: 'AI Stack (Local LLM)', link: '/projects/ai-stack' }
              ]
            }
          ],
          '/guides/': [
            {
              text: 'Guides',
              items: [{ text: 'Overview', link: '/guides/' }]
            }
          ]
        }
      }
    },

    th: {
      label: 'ภาษาไทย',
      lang: 'th-TH',
      link: '/th/',
      themeConfig: {
        langMenuLabel: 'เปลี่ยนภาษา',
        nav: [
          { text: 'โปรเจกต์', link: '/th/projects/' },
          { text: 'คู่มือ', link: '/th/guides/' },
          { text: 'dojojin.tech', link: 'https://dojojin.tech' }
        ],
        sidebar: {
          '/th/projects/': [
            {
              text: 'โปรเจกต์',
              items: [
                { text: 'ภาพรวม', link: '/th/projects/' },
                {
                  text: 'Vigil Platform',
                  items: [
                    { text: 'แพลตฟอร์ม', link: '/th/projects/vigil-platform' },
                    { text: 'แอปมือถือ', link: '/th/projects/vigil-mobile' }
                  ]
                },
                { text: 'AI OCR Pipeline', link: '/th/projects/ai-ocr-pipeline' },
                { text: 'AI Stack (Local LLM)', link: '/th/projects/ai-stack' }
              ]
            }
          ],
          '/th/guides/': [
            {
              text: 'คู่มือ',
              items: [{ text: 'ภาพรวม', link: '/th/guides/' }]
            }
          ]
        }
      }
    }
  },

  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/dojojin' }
    ],
    footer: {
      message: 'DOJOJIN.TECH — Engineering Portfolio'
    }
  }
})
