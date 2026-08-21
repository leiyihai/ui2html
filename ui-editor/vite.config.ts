import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      // 导出 HTML 保存：POST /save-export -> ../export/<name>.html
      name: 'save-export',
      configureServer(server) {
        server.middlewares.use('/save-export', (req: any, res: any) => {
          let body = ''
          req.on('data', (c: Buffer) => { body += c })
          req.on('end', () => {
            try {
              const { name, html, json } = JSON.parse(body)
              const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
              if (html) {
                fs.writeFileSync(path.resolve(__dirname, '../export', `${safe}.html`), html, 'utf-8')
              }
              if (json) {
                // psd 同名配置 json（锚点+九宫格），放 psd 文件夹，打开 psd 时读取
                fs.writeFileSync(path.resolve(__dirname, 'public/psd', `${safe}.json`), JSON.stringify(json, null, 2), 'utf-8')
              }
              res.statusCode = 200
              res.end('ok')
            } catch (e: any) {
              res.statusCode = 400
              res.end(String(e))
            }
          })
        })
      },
    },
  ],
})
