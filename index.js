const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const cron = require('node-cron')
const readline = require('readline')

const PALAVROES = ['porra','caralho','puta','buceta','viado','fdp','merda','vsf']
const NUMERO = process.env.NUMERO_WHATSAPP || ''
const avisos = {}
let sock, grupoJid

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    mobile: false
  })

  sock.ev.on('creds.update', saveCreds)

  // Solicitar código por número (sem QR Code)
  if (!sock.authState.creds.registered && NUMERO) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(NUMERO.replace(/\D/g, ''))
      console.log(`\n🔑 SEU CÓDIGO DE PAREAMENTO: ${code}\n`)
      console.log('👉 Vá em: WhatsApp > Aparelhos conectados > Conectar aparelho > Usar número de telefone')
      console.log(`👉 Digite o código: ${code}\n`)
    }, 3000)
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('✅ Bot conectado com sucesso!')
      try {
        const grupos = await sock.groupFetchAllParticipating()
        const entries = Object.entries(grupos)
        if (entries.length > 0) {
          grupoJid = entries[0][0]
          console.log('✅ Grupo:', entries[0][1].subject)
        }
      } catch(e) {
        console.log('Aguardando grupo...')
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconectando...')
        connectToWhatsApp()
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe || !grupoJid || msg.key.remoteJid !== grupoJid) continue
      const remetente = msg.key.participant || msg.key.remoteJid
      const meta = await sock.groupMetadata(grupoJid).catch(() => null)
      if (!meta) continue
      const admins = meta.participants.filter(p => p.admin).map(p => p.id)
      if (admins.includes(remetente)) continue
      const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase()
      let motivo = null
      if (texto.includes('chat.whatsapp.com')) motivo = 'postar link de grupo'
      else if (PALAVROES.some(p => texto.includes(p))) motivo = 'usar palavrão'
      if (!motivo) continue
      avisos[remetente] = (avisos[remetente] || 0) + 1
      await sock.sendMessage(grupoJid, { delete: msg.key })
      if (avisos[remetente] === 1) {
        await sock.sendMessage(grupoJid, { text: `⚠️ @${remetente.split('@')[0]} AVISO por ${motivo}! Próxima vez sai do grupo!`, mentions: [remetente] })
      } else {
        await sock.sendMessage(grupoJid, { text: `🚫 @${remetente.split('@')[0]} removido por ${motivo}!`, mentions: [remetente] })
        await sock.groupParticipantsUpdate(grupoJid, [remetente], 'remove').catch(() => {})
        delete avisos[remetente]
      }
    }
  })
}

// 22:30 BRT = 01:30 UTC
cron.schedule('30 1 * * *', async () => {
  if (!grupoJid || !sock) return
  await sock.groupSettingUpdate(grupoJid, 'announcement').catch(() => {})
  await sock.sendMessage(grupoJid, { text: '🔒 Grupo fechado! Boa noite! 😴\n— Bot DJ Maxx RS' })
  console.log('🔒 Grupo fechado 22:30')
})

// 06:30 BRT = 09:30 UTC
cron.schedule('30 9 * * *', async () => {
  if (!grupoJid || !sock) return
  await sock.groupSettingUpdate(grupoJid, 'not_announcement').catch(() => {})
  await sock.sendMessage(grupoJid, { text: '🔓 Grupo aberto! Bom dia! ☀️🔊\n— Bot DJ Maxx RS' })
  console.log('🔓 Grupo aberto 06:30')
})

console.log('🤖 Bot DJ Maxx RS iniciando...')
connectToWhatsApp()
