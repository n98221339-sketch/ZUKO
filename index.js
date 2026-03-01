// ════════════════════════════════════════════════════════════════════════════
//  🤖 BOT DISCORD TIẾNG VIỆT v2.0
//  Tính năng: VTV · Nối Từ VI · Nối Từ EN · Bầu Cua · Trinh Chiếu Video
//             Moderation (kick/ban/mute/warn/clear) · Anti (link/invite/spam)
//             Server Health · Role Scan · Perm Scan · Backup · Export Template
//             /help toàn bộ bằng tiếng Việt
// ════════════════════════════════════════════════════════════════════════════
require("dotenv").config();

const {
  Client, GatewayIntentBits, EmbedBuilder,
  REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  getVoiceConnection,
} = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Kiểm tra bắt buộc có token
if (!TOKEN || !CLIENT_ID) {
  console.error("\n❌ THIẾU BIẾN MÔI TRƯỜNG!");
  console.error("   Tạo file .env trong thư mục bot và thêm 2 dòng sau:");
  console.error("   DISCORD_TOKEN=token_của_bạn_ở_đây");
  console.error("   CLIENT_ID=client_id_của_bạn_ở_đây\n");
  process.exit(1);
}

// ─── 6 MẶT BẦU CUA (đúng theo hình: Nai·Bầu·Gà·Cá·Cua·Tôm) ─────────────────
const FACES = {
  1: { name: "Nai", emoji: "🦌" },
  2: { name: "Bầu", emoji: "🎰" },
  3: { name: "Gà", emoji: "🐓" },
  4: { name: "Cá", emoji: "🐟" },
  5: { name: "Cua", emoji: "🦀" },
  6: { name: "Tôm", emoji: "🦐" },
};

// ════════════════════════════════════════════════════════════════════════════
//  LOAD & INDEX DICTIONARY (dùng chung cho cả VI lẫn EN)
// ════════════════════════════════════════════════════════════════════════════
let DICT = [];
try {
  DICT = JSON.parse(fs.readFileSync(path.join(__dirname, "dictionary.json"), "utf-8"));
  console.log(`📖 Đã nạp từ điển: ${DICT.length} từ`);
} catch (e) {
  console.warn("⚠️  Không tìm thấy dictionary.json, dùng từ điển mẫu nhỏ.");
  DICT = [
    "học sinh", "sinh viên", "viên chức", "chức vụ", "vụ án", "án oan",
    "oan khuất", "khuất phục", "phục vụ", "vụ mùa", "mùa xuân", "xuân hè",
    "hè phố", "phố phường", "phường xã", "xã hội", "hội tụ", "tụ họp",
    "họp mặt", "mặt trận", "trận đấu", "đấu tranh", "tranh luận", "luận văn",
  ];
}

// Index theo âm tiết đầu (chữ thường) → danh sách từ
const VI_INDEX = Object.create(null);  // { "học": ["học sinh", "học bổng", ...] }
for (const w of DICT) {
  const key = w.trim().split(/\s+/)[0].toLowerCase();
  if (!Array.isArray(VI_INDEX[key])) VI_INDEX[key] = [];
  VI_INDEX[key].push(w);
}

// ════════════════════════════════════════════════════════════════════════════
//  STATE (in-memory — reset khi bot restart)
// ════════════════════════════════════════════════════════════════════════════
const S = {
  vtvCh: {},   // guildId → channelId (auto VTV)
  noiViCh: {},   // guildId → channelId (Nối từ VI)
  noiEnCh: {},   // guildId → channelId (Nối từ EN — để sau thêm từ EN)
  noiViSt: {},   // guildId → { lastWord, usedWords:Set }
  noiEnSt: {},   // guildId → { lastWord, usedWords:Set }
  logCh: {},   // guildId → channelId (log mod)
  anti: {},   // guildId → { link, invite, spam }
  antiSched: {},   // guildId → [{ type, onAt, offAt, timerId }]
  warns: {},   // guildId → userId → count
  spam: {},   // guildId → userId → [timestamps]
  backup: {},   // guildId → snapshot
  joinLog: {},   // guildId → [timestamp, ...]
  leaveLog: {},   // guildId → [timestamp, ...]
  msgLog: {},   // guildId → { "YYYY-MM-DD" → count }
  chMsgLog: {},   // guildId → chId → { lastMsg, count }
  // Music
  musicQueue: {},  // guildId → [ { url, title, requestedBy } ]
  musicPlaying: {}, // guildId → { player, connection, current }
};

// ════════════════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/** Chuẩn hoá chuỗi: bỏ khoảng trắng, sort ký tự → dùng so sánh anagram */
function normalize(str) {
  return str.replace(/[\s\/]/g, "").split("").sort().join("").toLowerCase();
}

/** Giải anagram từ bộ chữ (VD: t/n/í/ự/t/h) → trả về từ hoặc null */
function solveAnagram(letters) {
  const target = normalize(letters);
  for (const w of DICT) {
    if (normalize(w) === target) return w;
  }
  return null;
}

/** Lấy âm tiết cuối của từ (Tiếng Việt dùng dấu cách) */
const lastSyl = w => w.trim().split(/\s+/).pop().toLowerCase();

/** Lấy âm tiết đầu */
const firstSyl = w => w.trim().split(/\s+/)[0].toLowerCase();

/** Tìm từ VI bắt đầu bằng âm tiết, chưa dùng */
function findWordVI(syl, used) {
  const candidates = (VI_INDEX[syl] || []).filter(w => !used.has(w.toLowerCase()));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Gợi ý N từ VI bắt đầu bằng âm tiết, chưa dùng */
function hintVI(syl, used, n = 5) {
  return (VI_INDEX[syl] || [])
    .filter(w => !used.has(w.toLowerCase()))
    .slice(0, n);
}

/** Tìm từ EN bắt đầu bằng chữ cái cuối — dùng từ ASCII trong DICT */
function findWordEN(letter, used) {
  const letter_lc = letter.toLowerCase();
  const candidates = DICT.filter(w => {
    const lc = w.toLowerCase();
    return lc[0] === letter_lc && /^[a-z\s'-]+$/i.test(w) && !used.has(lc);
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Gợi ý N từ EN bắt đầu bằng chữ cái, chưa dùng */
function hintEN(letter, used, n = 5) {
  const letter_lc = letter.toLowerCase();
  return DICT.filter(w => {
    const lc = w.toLowerCase();
    return lc[0] === letter_lc && /^[a-z\s'-]+$/i.test(w) && !used.has(lc);
  }).slice(0, n);
}

/** Parse thời gian: "10m" → ms */
function parseDuration(str) {
  const m = str?.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  return { s: n * 1000, m: n * 60000, h: n * 3600000, d: n * 86400000 }[m[2].toLowerCase()];
}

/** Đơn vị thời gian sang chuỗi */
function durationLabel(ms) {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  if (ms < 86400000) return `${ms / 3600000}h`;
  return `${ms / 86400000}d`;
}

/** Check quyền */
const isAdmin = mb => mb?.permissions?.has(PermissionFlagsBits.Administrator);
const isMod = mb => mb?.permissions?.has(PermissionFlagsBits.ManageMessages) || isAdmin(mb);

/** Gửi log vào kênh log */
async function sendLog(guild, embed) {
  const id = S.logCh[guild.id];
  if (!id) return;
  try {
    const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    ch?.send({ embeds: [embed] });
  } catch { }
}

/** Ngày hôm nay dạng YYYY-MM-DD */
const today = () => new Date().toISOString().slice(0, 10);

/** Đếm tin nhắn */
function trackMsg(guildId, chId) {
  const d = today();
  if (!S.msgLog[guildId]) S.msgLog[guildId] = {};
  S.msgLog[guildId][d] = (S.msgLog[guildId][d] || 0) + 1;
  if (!S.chMsgLog[guildId]) S.chMsgLog[guildId] = {};
  if (!S.chMsgLog[guildId][chId]) S.chMsgLog[guildId][chId] = { lastMsg: 0, count: 0 };
  S.chMsgLog[guildId][chId].lastMsg = Date.now();
  S.chMsgLog[guildId][chId].count++;
}

// ════════════════════════════════════════════════════════════════════════════
//  MUSIC HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/** Lấy title video từ YouTube URL */
async function getYTTitle(url) {
  try {
    const info = await ytdl.getBasicInfo(url);
    return info.videoDetails.title;
  } catch {
    return url;
  }
}

/** Phát bài tiếp theo trong queue */
async function playNext(guildId, channel) {
  const queue = S.musicQueue[guildId];
  if (!queue || queue.length === 0) {
    // Hết queue - rời voice sau 30s
    setTimeout(() => {
      const conn = getVoiceConnection(guildId);
      if (conn) {
        const q = S.musicQueue[guildId];
        if (!q || q.length === 0) {
          conn.destroy();
          delete S.musicPlaying[guildId];
          channel?.send("✅ Hết hàng chờ nhạc — Bot đã rời voice channel!").catch(() => { });
        }
      }
    }, 30000);
    return;
  }

  const item = queue[0];
  try {
    const stream = ytdl(item.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream);
    const player = S.musicPlaying[guildId]?.player || createAudioPlayer();

    player.play(resource);
    S.musicPlaying[guildId] = { ...S.musicPlaying[guildId], player, current: item };

    // Khi bài kết thúc → phát bài tiếp
    player.once(AudioPlayerStatus.Idle, () => {
      S.musicQueue[guildId]?.shift();
      playNext(guildId, channel);
    });

    player.on("error", err => {
      console.error("Music player error:", err.message);
      S.musicQueue[guildId]?.shift();
      playNext(guildId, channel);
    });

    const embed = new EmbedBuilder().setColor(0xff0000)
      .setTitle("🎵 Đang phát")
      .setDescription(`**[${item.title}](${item.url})**`)
      .addFields(
        { name: "Yêu cầu bởi", value: item.requestedBy, inline: true },
        { name: "Còn trong queue", value: `${Math.max(0, queue.length - 1)} bài`, inline: true },
      )
      .setTimestamp();

    channel?.send({ embeds: [embed] }).catch(() => { });

  } catch (err) {
    console.error("playNext error:", err.message);
    channel?.send(`❌ Lỗi khi phát **${item.title}**: ${err.message}`).catch(() => { });
    S.musicQueue[guildId]?.shift();
    playNext(guildId, channel);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CLIENT SETUP
// ════════════════════════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════
const SLASH_CMDS = [

  // ── GAME ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("vtv")
    .setDescription("🎮 Giải chữ đảo VTV — chỉ mình bạn thấy đáp án")
    .addStringOption(o => o.setName("chu").setDescription("Bộ chữ VD: t/n/í/ự/t/h").setRequired(true)),

  new SlashCommandBuilder()
    .setName("baucua")
    .setDescription("🎲 Tính xác suất Bầu Cua Tôm Cá — chỉ mình bạn thấy")
    .addIntegerOption(o => o
      .setName("mat")
      .setDescription("Số mặt muốn cược: 1=🦌Nai 2=🎰Bầu 3=🐓Gà 4=🐟Cá 5=🦀Cua 6=🦐Tôm")
      .setMinValue(1).setMaxValue(6).setRequired(true)),

  new SlashCommandBuilder()
    .setName("mset")
    .setDescription("⚙️ Đặt kênh cho tính năng game/auto")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(o => o
      .setName("tinh_nang").setDescription("Chọn tính năng").setRequired(true)
      .addChoices(
        { name: "🎮 VTV — Giải chữ đảo tự động", value: "vtv" },
        { name: "🔗 Nối từ Tiếng Việt", value: "noitu_vi" },
        { name: "🔗 Nối từ Tiếng Anh", value: "noitu_en" },
      )),

  new SlashCommandBuilder()
    .setName("goiytunoi")
    .setDescription("💡 Gợi ý từ để nối (VI hoặc EN) — chỉ mình bạn thấy")
    .addStringOption(o => o.setName("am_tiet").setDescription("Âm tiết / chữ cái cần tìm (VD: 'sinh' hoặc 's')").setRequired(true))
    .addStringOption(o => o
      .setName("ngon_ngu").setDescription("Ngôn ngữ").setRequired(false)
      .addChoices({ name: "🇻🇳 Tiếng Việt (mặc định)", value: "vi" }, { name: "🇬🇧 Tiếng Anh", value: "en" })),

  // ── VIDEO ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("trinhchieuvideo")
    .setDescription("📺 Chia sẻ video YouTube — cả nhóm cùng xem")
    .addStringOption(o => o.setName("link").setDescription("Link YouTube").setRequired(true))
    .addStringOption(o => o.setName("mo_ta").setDescription("Mô tả / tiêu đề buổi xem").setRequired(false)),

  // ── MUSIC / VOICE ──────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("🎵 Phát nhạc/video YouTube trong voice channel")
    .addStringOption(o => o.setName("link").setDescription("Link YouTube").setRequired(true)),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("⏹️ Dừng phát nhạc và rời voice channel"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("⏭️ Bỏ qua bài hiện tại, phát bài tiếp theo trong hàng chờ"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("📋 Xem danh sách hàng chờ nhạc"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("⏸️ Tạm dừng phát nhạc"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("▶️ Tiếp tục phát nhạc sau khi tạm dừng"),

  // ── MODERATION ─────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("👢 Kick thành viên ra khỏi server")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần kick").setRequired(true))
    .addStringOption(o => o.setName("ly_do").setDescription("Lý do").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("🔨 Ban vĩnh viễn thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần ban").setRequired(true))
    .addStringOption(o => o.setName("ly_do").setDescription("Lý do").setRequired(false)),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("🔇 Mute thành viên có thời hạn")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần mute").setRequired(true))
    .addStringOption(o => o.setName("thoi_gian").setDescription("Thời gian: 10m · 1h · 2d").setRequired(true))
    .addStringOption(o => o.setName("ly_do").setDescription("Lý do").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("🔊 Bỏ mute thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần bỏ mute").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🗑️ Xoá tin nhắn hàng loạt trong kênh")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("so_luong").setDescription("Số tin cần xoá (1–100)").setMinValue(1).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("⚠️ Cảnh cáo thành viên (3 lần → tự mute 30 phút)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần cảnh cáo").setRequired(true))
    .addStringOption(o => o.setName("ly_do").setDescription("Lý do cảnh cáo").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnlist")
    .setDescription("📋 Xem số lần cảnh cáo của thành viên")
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần kiểm tra").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnreset")
    .setDescription("🔄 Xoá cảnh cáo của thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName("user").setDescription("Người dùng cần xoá cảnh cáo").setRequired(true)),

  // ── ANTI ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("anti")
    .setDescription("🛡️ Bật/tắt/xem tính năng bảo vệ tự động")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o
      .setName("tinh_nang").setDescription("Tính năng cần thao tác").setRequired(true)
      .addChoices(
        { name: "🔗 Anti Link (chặn HTTP link)", value: "link" },
        { name: "📨 Anti Invite (chặn link mời server)", value: "invite" },
        { name: "💬 Anti Spam (5 tin/5s → tự mute)", value: "spam" },
        { name: "📊 Xem trạng thái tất cả", value: "status" },
      ))
    .addStringOption(o => o
      .setName("trang_thai").setDescription("Bật hay tắt").setRequired(false)
      .addChoices({ name: "✅ Bật (on)", value: "on" }, { name: "❌ Tắt (off)", value: "off" }))
    .addStringOption(o => o
      .setName("hen_gio_bat").setDescription("Hẹn giờ BẬT (VD: 30m, 2h, 1d)").setRequired(false))
    .addStringOption(o => o
      .setName("hen_gio_tat").setDescription("Hẹn giờ TẮT (VD: 30m, 2h, 1d)").setRequired(false)),

  // ── LOG ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("📝 Đặt kênh ghi log moderation")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("kenh").setDescription("Kênh để ghi log").setRequired(true)),

  // ── SERVER MONITOR ─────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("serverhealth")
    .setDescription("📊 Xem thống kê sức khoẻ server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("rolescan")
    .setDescription("👥 Phân tích role: thừa, nguy hiểm, trùng quyền")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName("permscan")
    .setDescription("🔐 Quét quyền bất thường toàn server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ── BACKUP ─────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("📦 Sao lưu cấu trúc server vào bộ nhớ bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o
      .setName("hanh_dong").setDescription("Lưu hay xem backup").setRequired(true)
      .addChoices(
        { name: "💾 Lưu backup ngay bây giờ", value: "save" },
        { name: "📋 Xem thông tin backup", value: "view" },
      )),

  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("♻️ Khôi phục server từ backup — TẠO LẠI kênh + role (Admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("xac_nhan").setDescription("Gõ CONFIRM để xác nhận thực hiện").setRequired(true)),

  new SlashCommandBuilder()
    .setName("exporttemplate")
    .setDescription("📤 Xuất cấu trúc server thành file template .txt")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ── HELP ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("📖 Hướng dẫn toàn bộ tính năng bot bằng tiếng Việt — chỉ mình bạn thấy")
    .addStringOption(o => o
      .setName("muc").setDescription("Xem chi tiết từng mục").setRequired(false)
      .addChoices(
        { name: "🎮 Game (VTV, Nối từ, Bầu cua)", value: "game" },
        { name: "📺 Video (Trinh chiếu)", value: "video" },
        { name: "🛡️ Moderation & Anti", value: "mod" },
        { name: "📊 Server Monitor", value: "monitor" },
        { name: "📦 Backup Mức 2 & Restore", value: "backup" },
      )),

].map(c => c.toJSON());

// ════════════════════════════════════════════════════════════════════════════
//  READY — đăng ký slash commands
// ════════════════════════════════════════════════════════════════════════════
client.once("clientReady", async () => {
  console.log(`✅ Bot đã online: ${client.user.tag}`);
  client.user.setActivity("📖 /help để xem hướng dẫn", { type: 3 });

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: SLASH_CMDS });
    console.log("✅ Đã đăng ký tất cả Slash Commands!");
  } catch (e) {
    console.error("❌ Lỗi đăng ký Slash Commands:", e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  MEMBER JOIN / LEAVE — để track serverhealth
// ════════════════════════════════════════════════════════════════════════════
client.on("guildMemberAdd", member => {
  const g = member.guild.id;
  if (!S.joinLog[g]) S.joinLog[g] = [];
  S.joinLog[g].push(Date.now());
  S.joinLog[g] = S.joinLog[g].filter(t => Date.now() - t < 30 * 86400000);
});

client.on("guildMemberRemove", member => {
  const g = member.guild.id;
  if (!S.leaveLog[g]) S.leaveLog[g] = [];
  S.leaveLog[g].push(Date.now());
  S.leaveLog[g] = S.leaveLog[g].filter(t => Date.now() - t < 30 * 86400000);
});

// ════════════════════════════════════════════════════════════════════════════
//  MESSAGE CREATE — auto-detect VTV · Nối từ VI/EN · Anti
// ════════════════════════════════════════════════════════════════════════════
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  const gid = msg.guild.id;
  const content = msg.content.trim();
  const anti = S.anti[gid] || {};

  // Đếm tin nhắn cho serverhealth
  trackMsg(gid, msg.channel.id);

  // ── Anti Invite Link ────────────────────────────────────────────────────
  if (anti.invite && !isMod(msg.member)) {
    if (/discord\.gg\/\S+/i.test(content)) {
      await msg.delete().catch(() => { });
      await msg.channel.send(`🚫 <@${msg.author.id}> không được đăng link mời server khác!`).then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
      await sendLog(msg.guild, new EmbedBuilder().setColor(0xed4245)
        .setTitle("🛡️ Anti Invite — Đã xoá link mời")
        .addFields(
          { name: "Người dùng", value: `${msg.author.tag} (<@${msg.author.id}>)`, inline: true },
          { name: "Kênh", value: `<#${msg.channel.id}>`, inline: true },
          { name: "Nội dung", value: content.slice(0, 300) },
        ).setTimestamp());
      return;
    }
  }

  // ── Anti Link (HTTP) ────────────────────────────────────────────────────
  if (anti.link && !isMod(msg.member)) {
    if (/https?:\/\/\S+/i.test(content) && !/discord\.gg/i.test(content)) {
      await msg.delete().catch(() => { });
      await msg.channel.send(`🔗 <@${msg.author.id}> không được đăng link trong kênh này!`).then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
      await sendLog(msg.guild, new EmbedBuilder().setColor(0xffa500)
        .setTitle("🔗 Anti Link — Đã xoá link")
        .addFields(
          { name: "Người dùng", value: `${msg.author.tag}`, inline: true },
          { name: "Kênh", value: `<#${msg.channel.id}>`, inline: true },
        ).setTimestamp());
      return;
    }
  }

  // ── Anti Spam (5 tin / 5 giây) ──────────────────────────────────────────
  if (anti.spam && !isMod(msg.member)) {
    if (!S.spam[gid]) S.spam[gid] = {};
    if (!S.spam[gid][msg.author.id]) S.spam[gid][msg.author.id] = [];
    const now = Date.now();
    S.spam[gid][msg.author.id].push(now);
    S.spam[gid][msg.author.id] = S.spam[gid][msg.author.id].filter(t => now - t < 5000);
    if (S.spam[gid][msg.author.id].length >= 5) {
      try {
        await msg.member.timeout(10 * 60 * 1000, "Auto-mute: spam tin nhắn");
        await msg.channel.send(`🔇 <@${msg.author.id}> đã bị **tự động mute 10 phút** do spam!`);
        await sendLog(msg.guild, new EmbedBuilder().setColor(0xed4245)
          .setTitle("🤖 Auto-Mute — Spam")
          .addFields({ name: "Người dùng", value: `${msg.author.tag}`, inline: true }, { name: "Thời gian", value: "10 phút", inline: true })
          .setTimestamp());
        S.spam[gid][msg.author.id] = [];
      } catch { }
      return;
    }
  }

  // ── Auto VTV — đọc "Từ cần đoán:" ─────────────────────────────────────
  if (S.vtvCh[gid] === msg.channel.id && content.includes("Từ cần đoán:")) {
    const match = content.match(/Từ cần đoán:\s*([^\n]+)/i);
    if (match) {
      const letters = match[1].trim();
      const answer = solveAnagram(letters);
      if (answer) {
        return msg.channel.send({
          embeds: [
            new EmbedBuilder().setColor(0x57f287)
              .setTitle("🎮 VUA TIẾNG VIỆT — Đáp án!")
              .addFields(
                { name: "Bộ chữ", value: `\`${letters}\``, inline: true },
                { name: "✅ Đáp án", value: `**${answer}**`, inline: true },
              )
              .setFooter({ text: "💡 Dùng /vtv để xem đáp án chỉ mình bạn thấy!" })
              .setTimestamp()
          ]
        });
      } else {
        return msg.channel.send(`❓ Không tìm thấy đáp án cho bộ chữ: \`${letters}\``);
      }
    }
  }

  // ── Auto Nối từ TIẾNG VIỆT ─────────────────────────────────────────────
  if (S.noiViCh[gid] === msg.channel.id) {
    const st = S.noiViSt[gid] || { lastWord: null, usedWords: new Set() };
    const word = content.toLowerCase().trim();

    // Không bắt lệnh /
    if (content.startsWith("/")) return;

    // Kiểm tra từ có trong từ điển không
    const inDict = DICT.some(w => w.toLowerCase() === word);
    if (!inDict) { await msg.react("❌"); return; }

    // Đã dùng rồi?
    if (st.usedWords.has(word)) {
      return msg.reply("⚠️ Từ **" + word + "** đã được dùng trong vòng này rồi!");
    }

    // Kiểm tra nối đúng
    if (st.lastWord) {
      const needed = lastSyl(st.lastWord);
      if (firstSyl(word) !== needed) {
        return msg.reply(`❌ Phải bắt đầu bằng âm tiết **"${needed}"**! Từ cuối cùng là: **${st.lastWord}**`);
      }
    }

    // Hợp lệ
    st.usedWords.add(word);
    st.lastWord = word;
    await msg.react("✅");

    // Bot tìm từ tiếp theo
    const nextSyl = lastSyl(word);
    const botWord = findWordVI(nextSyl, st.usedWords);
    const hints = hintVI(nextSyl, botWord ? new Set([...st.usedWords, botWord.toLowerCase()]) : st.usedWords, 4);

    if (!botWord) {
      S.noiViSt[gid] = st;
      return msg.channel.send(
        `😵 **Bot thua!** Không tìm được từ bắt đầu bằng **"${nextSyl}"**\n` +
        `🏆 Bạn thắng rồi! Dùng \`/mset noitu_vi\` trong kênh này để chơi lại.`
      );
    }

    st.usedWords.add(botWord.toLowerCase());
    st.lastWord = botWord;
    S.noiViSt[gid] = st;

    const nextLetter = lastSyl(botWord);
    const hintStr = hints.length ? `\n💡 Gợi ý: ${hints.map(h => `\`${h}\``).join(", ")}` : "";

    return msg.channel.send(
      `🤖 **${botWord}**\n` +
      `➡️ Đến lượt bạn — bắt đầu bằng: **"${nextLetter}"**` +
      hintStr
    );
  }

  // ── Auto Nối từ TIẾNG ANH ──────────────────────────────────────────────
  if (S.noiEnCh[gid] === msg.channel.id) {
    const st = S.noiEnSt[gid] || { lastWord: null, usedWords: new Set() };
    const word = content.toLowerCase().trim();

    if (content.startsWith("/")) return;
    if (!/^[a-z\s'-]+$/.test(word)) { await msg.react("❌"); return; }

    const inDict = DICT.some(w => /^[a-z\s'-]+$/i.test(w) && w.toLowerCase() === word);
    if (!inDict) { await msg.react("❌"); return; }

    if (st.usedWords.has(word)) {
      return msg.reply("⚠️ Word **" + word + "** was already used!");
    }

    if (st.lastWord) {
      const needed = st.lastWord[st.lastWord.length - 1];
      if (word[0] !== needed) {
        return msg.reply(`❌ Must start with letter **"${needed.toUpperCase()}"**! Last word: **${st.lastWord}**`);
      }
    }

    st.usedWords.add(word);
    st.lastWord = word;
    await msg.react("✅");

    const lastLetter = word[word.length - 1];
    const botWord = findWordEN(lastLetter, st.usedWords);
    const hints = hintEN(lastLetter, botWord ? new Set([...st.usedWords, botWord.toLowerCase()]) : st.usedWords, 4);

    if (!botWord) {
      S.noiEnSt[gid] = st;
      return msg.channel.send(
        `😵 **Bot loses!** No word starting with **"${lastLetter.toUpperCase()}"**\n` +
        `🏆 You win! Use \`/mset noitu_en\` here to restart.`
      );
    }

    st.usedWords.add(botWord.toLowerCase());
    st.lastWord = botWord;
    S.noiEnSt[gid] = st;

    const nextL = botWord[botWord.length - 1];
    const hintStr = hints.length ? `\n💡 Hints: ${hints.map(h => `\`${h}\``).join(", ")}` : "";

    return msg.channel.send(
      `🤖 **${botWord}**\n` +
      `➡️ Your turn — start with: **"${nextL.toUpperCase()}"**` +
      hintStr
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  INTERACTION CREATE — Slash Commands
// ════════════════════════════════════════════════════════════════════════════
client.on("interactionCreate", async interaction => {
  try {
    // ── Button: Tham gia xem video ──────────────────────────────────────────
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("join_watch_")) {
        const sharedBy = interaction.customId.replace("join_watch_", "");
        return interaction.reply({
          content: `🍿 <@${interaction.user.id}> đã **tham gia xem** cùng <@${sharedBy}>! Cùng vào xem nào! 🎬`,
        });
      }

      // Nút Dừng chiếu — chỉ người dùng có quyền ManageChannels hoặc người trinh chiếu mới dừng được
      if (interaction.customId.startsWith("stop_watch_")) {
        const buttonGid = interaction.customId.replace("stop_watch_", "");
        const canStop = interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels);
        if (!canStop) {
          return interaction.reply({ content: "❌ Chỉ **Mod/Admin** mới có thể dừng buổi chiếu!", flags: 64 });
        }
        const conn = getVoiceConnection(buttonGid);
        if (conn) {
          S.musicPlaying[buttonGid]?.player?.stop();
          conn.destroy();
          delete S.musicPlaying[buttonGid];
          delete S.musicQueue[buttonGid];
        }
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xed4245)
            .setTitle("⏹️ Buổi chiếu đã bị dừng")
            .setDescription(`<@${interaction.user.id}> đã dừng buổi trinh chiếu.`)
            .setTimestamp()
          ],
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return; // bỏ qua DM/interaction không có guild

    const { commandName: cmd, guild, member } = interaction;
    const gid = guild?.id;

    // ════════════════════════════════════════════════════════════════════════
    //  /help
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "help") {
      const muc = interaction.options.getString("muc");
      let embed;

      if (!muc) {
        // Tổng quan
        embed = new EmbedBuilder().setColor(0x5865f2)
          .setTitle("📖 BOT DISCORD TIẾNG VIỆT v2.0 — Tổng quan")
          .setDescription(
            "Dùng `/help muc:<mục>` để xem chi tiết từng phần.\n" +
            "Mọi lệnh `/help` chỉ **mình bạn thấy**, người khác không biết bạn đang hỏi gì. 😄"
          )
          .addFields(
            { name: "🎮 GAME", value: "`/vtv` `/baucua` `/mset` `/goiytunoi`\nTự động giải VTV · Nối từ VI/EN · Tính xác suất Bầu Cua" },
            { name: "📺 VIDEO & NHẠC", value: "`/trinhchieuvideo` `/play` `/stop` `/skip` `/pause` `/resume` `/queue`\nPhát nhạc YouTube trong voice · Chia sẻ video cùng nhóm" },
            { name: "🛡️ MOD", value: "`/kick` `/ban` `/mute` `/unmute` `/clear` `/warn` `/warnlist` `/warnreset`\n`/anti` `/setlog`\nMod cơ bản + bảo vệ tự động + log" },
            { name: "📊 MONITOR", value: "`/serverhealth` `/rolescan` `/permscan`\nGiám sát sức khoẻ · Phân tích role · Quét quyền" },
            { name: "📦 BACKUP MỨC 2", value: "`/backup save/view` `/restore` `/exporttemplate`\n✅ Backup lưu ra file · Khôi phục tạo lại kênh + role · Xuất template" },
            { name: "ℹ️ Ghi chú", value: "• Lệnh 🔒 yêu cầu quyền Admin/Mod\n• `/vtv` và `/baucua` chỉ mình bạn thấy\n• Log mod ghi vào kênh đặt bởi `/setlog`" },
          )
          .setFooter({ text: "Bot Tiếng Việt v2.0 | Dùng /help muc:game để xem chi tiết" });

      } else if (muc === "game") {
        embed = new EmbedBuilder().setColor(0x57f287).setTitle("🎮 HƯỚNG DẪN — GAME")
          .addFields(
            {
              name: "🎮 VTV — Giải chữ đảo",
              value:
                "**Nguyên lý:** Bot nhận bộ chữ → bỏ dấu `/` → sort ký tự → so khớp với từ điển.\n" +
                "**Cách dùng:**\n" +
                "① `/mset tinh_nang:VTV` trong kênh game để bot tự đọc.\n" +
                "② Bot tự động trả lời khi kênh nhận được tin có `Từ cần đoán: x/x/x`.\n" +
                "③ Hoặc dùng `/vtv chu:t/n/í/ự/t/h` → Đáp án **chỉ mình bạn thấy**.",
            },
            {
              name: "🔗 Nối từ Tiếng Việt",
              value:
                "**Nguyên lý:** Lấy **âm tiết cuối** của từ trước → tìm từ **bắt đầu bằng âm tiết đó**.\n" +
                "**Cách dùng:**\n" +
                "① `/mset tinh_nang:Nối từ Tiếng Việt` trong kênh chơi.\n" +
                "② Gõ từ tiếng Việt vào kênh → Bot nối tiếp ngay lập tức.\n" +
                "③ Bot hiển thị **gợi ý** từ trong từ điển sau mỗi lượt.\n" +
                "④ Từ đã dùng không được dùng lại.\n" +
                "**Gợi ý thủ công:** `/goiytunoi am_tiet:sinh ngon_ngu:VI`",
            },
            {
              name: "🔗 Nối từ Tiếng Anh",
              value:
                "**Nguyên lý:** Lấy **chữ cái cuối** của từ trước → tìm từ tiếng Anh **bắt đầu bằng chữ đó**.\n" +
                "**Cách dùng:**\n" +
                "① `/mset tinh_nang:Nối từ Tiếng Anh` trong kênh chơi.\n" +
                "② Gõ từ tiếng Anh → Bot nối tiếp.\n" +
                "③ Gợi ý từ điển sau mỗi lượt.\n" +
                "**Gợi ý thủ công:** `/goiytunoi am_tiet:s ngon_ngu:EN`",
            },
            {
              name: "🎲 Bầu Cua Tôm Cá",
              value:
                "**6 mặt:** 🦌Nai(1) · 🎰Bầu(2) · 🐓Gà(3) · 🐟Cá(4) · 🦀Cua(5) · 🦐Tôm(6)\n" +
                "**Cách dùng:** `/baucua mat:3` (chọn Gà)\n" +
                "**Kết quả:** Bot tung 3 xúc xắc ảo + hiển thị xác suất lý thuyết.\n" +
                "**Công thức:** P(≥1 lần) = 1 − (5/6)³ ≈ **42.13%**\n" +
                "**EV (kỳ vọng):** = 0.421×1 + 0.069×2 + 0.005×3 ≈ **0.5** → Bot luôn có lợi về lâu dài.",
            },
          );

      } else if (muc === "video") {
        embed = new EmbedBuilder().setColor(0xff0000).setTitle("📺 HƯỚNG DẪN — TRINH CHIẾU VIDEO")
          .addFields(
            {
              name: "Cách dùng",
              value:
                "`/trinhchieuvideo link:<URL YouTube> mo_ta:<Mô tả>`\n\n" +
                "**Tính năng:**\n" +
                "• Bạn phải vào **Voice Channel** trước.\n" +
                "• Bot tự vào voice và **phát audio** từ YouTube.\n" +
                "• Gửi embed thông báo có thumbnail video cho cả nhóm.\n" +
                "• Có nút **▶️ Xem Video** để mở link · **✅ Tham gia xem** để báo nhóm.\n" +
                "• Có nút **⏹️ Dừng chiếu** (chỉ Mod/Admin).\n" +
                "• Bot tự rời voice khi video phát xong.\n\n" +
                "💡 **Cách xem cùng nhau:** Bot phát audio trong voice → mọi người vào voice nghe + tự mở link video trên trình duyệt cùng lúc!",
            },
            {
              name: "Ví dụ",
              value: "`/trinhchieuvideo link:https://youtu.be/xxx mo_ta:Xem phim tối nay cùng nhau nhé!`",
            },
          );

      } else if (muc === "mod") {
        embed = new EmbedBuilder().setColor(0xed4245).setTitle("🛡️ HƯỚNG DẪN — MODERATION & ANTI")
          .addFields(
            {
              name: "Lệnh cơ bản",
              value:
                "`/kick @user [lý do]` — Đuổi khỏi server (cần quyền Kick)\n" +
                "`/ban @user [lý do]` — Ban vĩnh viễn (cần quyền Ban)\n" +
                "`/mute @user 10m [lý do]` — Mute có thời hạn. Đơn vị: `s` `m` `h` `d`\n" +
                "`/unmute @user` — Bỏ mute\n" +
                "`/clear 50` — Xoá 50 tin gần nhất (tối đa 100)\n" +
                "`/warn @user lý do` — Cảnh cáo. Đủ **3 lần** → tự mute 30 phút\n" +
                "`/warnlist @user` — Xem số lần cảnh cáo\n" +
                "`/warnreset @user` — Xoá hết cảnh cáo (Admin)",
            },
            {
              name: "🛡️ Anti tự động (`/anti`)",
              value:
                "`/anti tinh_nang:Anti Link trang_thai:Bật` — Chặn mọi http link\n" +
                "`/anti tinh_nang:Anti Invite trang_thai:Bật` — Chặn link mời server khác\n" +
                "`/anti tinh_nang:Anti Spam trang_thai:Bật` — Spam 5 tin/5s → tự mute 10 phút\n" +
                "`/anti tinh_nang:Xem trạng thái` — Xem bật/tắt từng cái\n\n" +
                "**Hẹn giờ:**\n" +
                "`/anti tinh_nang:Anti Spam hen_gio_bat:30m` — Bật Anti Spam sau 30 phút\n" +
                "`/anti tinh_nang:Anti Spam hen_gio_tat:2h` — Tắt Anti Spam sau 2 giờ",
            },
            {
              name: "📝 Log Moderation",
              value:
                "`/setlog kenh:#kênh-log` — Mọi hành động mod đều được ghi vào kênh này.\n" +
                "Log gồm: kick, ban, mute, warn, auto-mute, xoá link invite/http.",
            },
          );

      } else if (muc === "monitor") {
        embed = new EmbedBuilder().setColor(0xfee75c).setTitle("📊 HƯỚNG DẪN — SERVER MONITOR")
          .addFields(
            {
              name: "/serverhealth",
              value:
                "**Phân tích:**\n" +
                "• Tổng member (người + bot)\n" +
                "• Số người join / rời trong 7 ngày\n" +
                "• Số tin nhắn hôm nay vs hôm qua\n" +
                "• 🔥 Top 3 kênh sôi động nhất\n" +
                "• 💀 Kênh không có tin nhắn trong 7 ngày\n" +
                "• Tổng số kênh, role, category",
            },
            {
              name: "/rolescan",
              value:
                "**Phân tích role:**\n" +
                "• Role không có ai dùng (gợi ý xoá)\n" +
                "• Role có quyền **Administrator** (nguy hiểm)\n" +
                "• Role có quyền **Ban/Kick** không cần thiết\n" +
                "• Đếm số role theo nhóm quyền",
            },
            {
              name: "/permscan",
              value:
                "**Quét quyền bất thường:**\n" +
                "• Role nào có quyền Administrator\n" +
                "• Role nào có quyền Manage Server\n" +
                "• Kênh nào cho @everyone gửi tin nhắn\n" +
                "• Đưa ra cảnh báo màu đỏ/cam/vàng theo mức độ",
            },
          );

      } else if (muc === "backup") {
        embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📦 HƯỚNG DẪN — BACKUP MỨC 2 & RESTORE")
          .addFields(
            {
              name: "/backup save",
              value:
                "Lưu toàn bộ cấu trúc server:\n" +
                "• Category + thứ tự · Kênh text/voice + topic + cài đặt\n" +
                "• Role + màu + quyền + hoist\n" +
                "✅ Ghi vào RAM **và file `backup_<guildID>.json`** — **KHÔNG MẤT khi bot restart!**",
            },
            {
              name: "/backup view",
              value:
                "Xem thông tin backup đã lưu (tự load từ file nếu bot restart)\n" +
                "• Thời gian lưu · Tên server · Số kênh / role / category",
            },
            {
              name: "♻️ /restore CONFIRM",
              value:
                "**Tạo lại y hệt server gốc trong server hiện tại:**\n" +
                "① Tạo lại toàn bộ **Role** (tên, màu, quyền)\n" +
                "② Tạo lại **Category** (đúng thứ tự)\n" +
                "③ Tạo lại **Kênh** (gán đúng category, topic, bitrate...)\n\n" +
                "⚠️ Bot cần quyền **Administrator** trong server đích!\n" +
                "💡 Cách dùng:\n1. Server gốc → `/backup save`\n2. Invite bot vào server mới\n3. Server mới → `/restore` → gõ `CONFIRM`",
            },
            {
              name: "/exporttemplate",
              value:
                "Xuất cấu trúc server thành **file .txt** đính kèm:\n" +
                "• Toàn bộ category + kênh dưới dạng cây thư mục\n" +
                "• Danh sách role + màu\n" +
                "• Phù hợp để tạo server mới theo mẫu, chia sẻ template.",
            },
          );
      }

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /mset
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "mset") {
      const tf = interaction.options.getString("tinh_nang");
      const chId = interaction.channel.id;
      const chName = interaction.channel.name;

      if (tf === "vtv") {
        S.vtvCh[gid] = chId;
        return interaction.reply({ content: `✅ Kênh **#${chName}** đã được đặt cho **VTV — Giải chữ đảo tự động**.`, flags: 64 });
      }
      if (tf === "noitu_vi") {
        S.noiViCh[gid] = chId;
        S.noiViSt[gid] = { lastWord: null, usedWords: new Set() };
        return interaction.reply({ content: `✅ Kênh **#${chName}** đã được đặt cho **Nối từ Tiếng Việt**. Gõ từ bất kỳ để bắt đầu!`, flags: 64 });
      }
      if (tf === "noitu_en") {
        S.noiEnCh[gid] = chId;
        S.noiEnSt[gid] = { lastWord: null, usedWords: new Set() };
        return interaction.reply({ content: `✅ Kênh **#${chName}** đã được đặt cho **Nối từ Tiếng Anh**. Type any English word to start!`, flags: 64 });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /vtv
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "vtv") {
      const letters = interaction.options.getString("chu");
      const answer = solveAnagram(letters);
      const embed = new EmbedBuilder()
        .setColor(answer ? 0x57f287 : 0xed4245)
        .setTitle("🎮 VUA TIẾNG VIỆT — Đáp án 👁️ (chỉ mình bạn thấy)");

      if (answer) {
        embed.addFields(
          { name: "🔤 Bộ chữ", value: `\`${letters}\``, inline: true },
          { name: "✅ Đáp án", value: `**${answer}**`, inline: true },
        ).setFooter({ text: `Tìm thấy trong từ điển ${DICT.length} từ` });
      } else {
        embed.setDescription(`❌ Không tìm thấy từ khớp với bộ chữ: \`${letters}\`\n\n💡 Hãy kiểm tra lại bộ chữ hoặc từ chưa có trong từ điển.`);
      }
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /goiytunoi — Gợi ý từ để nối (chỉ mình thấy)
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "goiytunoi") {
      const amTiet = interaction.options.getString("am_tiet").toLowerCase().trim();
      const lang = interaction.options.getString("ngon_ngu") || "vi";

      let words = [];
      if (lang === "vi") {
        words = hintVI(amTiet, new Set(), 10);
      } else {
        words = hintEN(amTiet, new Set(), 10);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`💡 Gợi ý từ — ${lang === "vi" ? "🇻🇳 Tiếng Việt" : "🇬🇧 Tiếng Anh"} — chỉ mình bạn thấy`)
        .setDescription(
          words.length
            ? `Từ bắt đầu bằng **"${amTiet}"** (${words.length} gợi ý):\n\n` +
            words.map((w, i) => `${i + 1}. \`${w}\``).join("\n")
            : `❌ Không có từ nào bắt đầu bằng **"${amTiet}"** trong từ điển.`
        )
        .setFooter({ text: `Từ điển: ${DICT.length} từ | Chỉ mình bạn thấy` });

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /baucua
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "baucua") {
      const mat = interaction.options.getInteger("mat");
      const face = FACES[mat];

      // Tung 3 xúc xắc ảo
      const rolls = [1, 2, 3].map(() => Math.ceil(Math.random() * 6));
      const hits = rolls.filter(r => r === mat).length;
      const rollDisplay = rolls.map(r => `${FACES[r].emoji} ${FACES[r].name}`).join("  |  ");

      // Công thức xác suất
      const p1 = (1 / 6) * 100;
      const pNone = Math.pow(5 / 6, 3);
      const pAt1 = (1 - pNone) * 100;
      const pEx1 = 3 * (1 / 6) * Math.pow(5 / 6, 2) * 100;
      const pEx2 = 3 * Math.pow(1 / 6, 2) * (5 / 6) * 100;
      const pEx3 = Math.pow(1 / 6, 3) * 100;
      const ev = (pEx1 / 100) * 1 + (pEx2 / 100) * 2 + (pEx3 / 100) * 3;

      let ketQua = "";
      if (hits === 0) ketQua = "😢 Không ra mặt này. **Thua!**";
      else if (hits === 1) ketQua = `🎉 Ra **1 lần**! Thắng **x1** cược!`;
      else if (hits === 2) ketQua = `🎉🎉 Ra **2 lần**! Thắng **x2** cược!`;
      else ketQua = `🎉🎉🎉 Ra **3 lần**! Thắng **x3** cược! Jackpot!`;

      const embed = new EmbedBuilder().setColor(0xfee75c)
        .setTitle(`🎲 BẦU CUA TÔM CÁ — Bạn chọn: ${face.emoji} ${face.name}`)
        .addFields(
          {
            name: "🎯 Kết quả 3 viên xúc xắc",
            value: `${rollDisplay}\n\n${ketQua}`,
          },
          {
            name: "📊 Xác suất lý thuyết (1 mặt / 3 viên)",
            value:
              `• 1 viên ra đúng: **${p1.toFixed(2)}%**\n` +
              `• Ít nhất 1/3 viên: **${pAt1.toFixed(2)}%**\n` +
              `• Đúng 1 viên: **${pEx1.toFixed(2)}%** → thắng x1\n` +
              `• Đúng 2 viên: **${pEx2.toFixed(2)}%** → thắng x2\n` +
              `• Đúng 3 viên: **${pEx3.toFixed(2)}%** → thắng x3`,
            inline: true,
          },
          {
            name: "💰 Kỳ vọng (EV)",
            value:
              `EV = **${ev.toFixed(4)}**\n` +
              `Tức mỗi 1đ cược → kỳ vọng thu **${ev.toFixed(4)}đ**\n` +
              `${ev >= 1 ? "✅ Có lợi về lý thuyết" : "❌ Bất lợi về lâu dài"}`,
            inline: true,
          },
          {
            name: "🎰 6 Mặt Bầu Cua",
            value: Object.entries(FACES).map(([k, v]) => `**${k}** ${v.emoji} ${v.name}`).join(" · "),
          },
        )
        .setFooter({ text: "Chỉ mình bạn thấy | Bầu cua chỉ mang tính giải trí!" });

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /trinhchieuvideo — Gửi embed cho nhóm + bot vào voice phát audio
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "trinhchieuvideo") {
      const link = interaction.options.getString("link");
      const moTa = interaction.options.getString("mo_ta") || "Cùng xem nào! 🍿";

      // Chỉ hỗ trợ YouTube
      if (!/youtube\.com|youtu\.be/i.test(link)) {
        return interaction.reply({ content: "❌ Chỉ hỗ trợ link **YouTube**!", flags: 64 });
      }

      // Bắt buộc người dùng phải vào voice trước
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: "❌ Bạn phải vào **Voice Channel** trước để bot vào phát âm thanh!", flags: 64 });
      }

      // Kiểm tra quyền bot vào voice
      const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
      if (!perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
        return interaction.reply({ content: "❌ Bot không có quyền vào hoặc nói trong voice channel đó!", flags: 64 });
      }

      await interaction.deferReply();

      try {
        // Lấy title video
        const title = await getYTTitle(link);

        // Lấy video ID để lấy thumbnail
        let videoId = null;
        const m1 = link.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        const m2 = link.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (m1) videoId = m1[1];
        else if (m2) videoId = m2[1];

        // ── BƯỚC 1: Gửi embed thông báo cho cả nhóm ──────────────────────────
        const announceEmbed = new EmbedBuilder().setColor(0xff0000)
          .setTitle("📺 TRINH CHIẾU VIDEO — Cả nhóm cùng xem!")
          .setDescription(
            `🎬 <@${interaction.user.id}> đang bắt đầu buổi xem phim!\n\n` +
            `📝 **${moTa}**\n\n` +
            `🎵 **Bot đã vào voice** — Âm thanh đang phát trong **${voiceChannel.name}**!\n` +
            `🔗 **Link video:** ${link}\n\n` +
            `👇 Nhấn **▶️ Xem Video** để mở video · **✅ Tham gia** để báo với nhóm!`
          )
          .addFields(
            { name: "🎬 Tên video", value: `**${title}**`, inline: false },
            { name: "🔊 Voice Channel", value: voiceChannel.name, inline: true },
            { name: "👤 Chia sẻ bởi", value: `<@${interaction.user.id}>`, inline: true },
          )
          .setTimestamp()
          .setFooter({ text: "Mở video trên trình duyệt + vào voice để xem cùng nhau!" });

        if (videoId) {
          announceEmbed.setImage(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("▶️ Xem Video")
            .setStyle(ButtonStyle.Link)
            .setURL(link),
          new ButtonBuilder()
            .setCustomId(`join_watch_${interaction.user.id}`)
            .setLabel("✅ Tham gia xem")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`stop_watch_${gid}`)
            .setLabel("⏹️ Dừng chiếu")
            .setStyle(ButtonStyle.Danger),
        );

        await interaction.editReply({ embeds: [announceEmbed], components: [row] });

        // ── BƯỚC 2: Bot vào voice và phát audio ──────────────────────────────
        // Nếu bot đang ở voice khác thì rời ra trước
        const existingConn = getVoiceConnection(gid);
        if (existingConn) existingConn.destroy();

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: gid,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        // Lưu vào state để nút "Dừng chiếu" có thể dừng
        if (!S.musicPlaying[gid]) S.musicPlaying[gid] = {};
        S.musicPlaying[gid].connection = connection;
        S.musicPlaying[gid].player = player;
        S.musicPlaying[gid].current = { url: link, title, requestedBy: interaction.user.tag };
        S.musicQueue[gid] = [{ url: link, title, requestedBy: interaction.user.tag }];

        // Xử lý khi connection bị ngắt
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
          } catch {
            connection.destroy();
            delete S.musicPlaying[gid];
            delete S.musicQueue[gid];
          }
        });

        // Phát audio từ YouTube
        const stream = ytdl(link, {
          filter: "audioonly",
          quality: "highestaudio",
          highWaterMark: 1 << 25,
        });
        const resource = createAudioResource(stream);
        player.play(resource);

        // Khi phát xong tự rời voice
        player.once(AudioPlayerStatus.Idle, () => {
          setTimeout(() => {
            getVoiceConnection(gid)?.destroy();
            delete S.musicPlaying[gid];
            delete S.musicQueue[gid];
            interaction.channel?.send({
              embeds: [new EmbedBuilder().setColor(0x57f287)
                .setTitle("✅ Buổi chiếu đã kết thúc!")
                .setDescription(`**${title}** đã phát xong.\nBot đã rời voice channel **${voiceChannel.name}**.`)
                .setTimestamp()
              ]
            }).catch(() => { });
          }, 2000);
        });

        player.on("error", err => {
          console.error("trinhchieuvideo player error:", err.message);
          interaction.channel?.send(`❌ Lỗi phát audio: ${err.message}`).catch(() => { });
          getVoiceConnection(gid)?.destroy();
          delete S.musicPlaying[gid];
          delete S.musicQueue[gid];
        });

      } catch (err) {
        return interaction.editReply({ content: `❌ Lỗi: ${err.message}` });
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /play — Tham gia voice + phát nhạc YouTube
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "play") {
      const link = interaction.options.getString("link");

      // Kiểm tra link YouTube
      if (!/youtube\.com|youtu\.be/i.test(link)) {
        return interaction.reply({ content: "❌ Chỉ hỗ trợ link **YouTube**!", flags: 64 });
      }

      // Kiểm tra người dùng có trong voice không
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: "❌ Bạn phải vào **Voice Channel** trước!", flags: 64 });
      }

      // Kiểm tra bot có quyền vào voice không
      const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
      if (!perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
        return interaction.reply({ content: "❌ Bot không có quyền vào hoặc nói trong voice channel đó!", flags: 64 });
      }

      await interaction.deferReply();

      try {
        // Lấy title video
        const title = await getYTTitle(link);

        // Thêm vào queue
        if (!S.musicQueue[gid]) S.musicQueue[gid] = [];
        S.musicQueue[gid].push({
          url: link,
          title,
          requestedBy: interaction.user.tag,
        });

        // Nếu đang phát rồi → chỉ thêm vào queue
        if (S.musicPlaying[gid]?.player?.state?.status === AudioPlayerStatus.Playing ||
          S.musicPlaying[gid]?.player?.state?.status === AudioPlayerStatus.Buffering) {
          return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57f287)
              .setTitle("✅ Đã thêm vào hàng chờ")
              .setDescription(`**[${title}](${link})**`)
              .addFields(
                { name: "Vị trí", value: `#${S.musicQueue[gid].length}`, inline: true },
                { name: "Yêu cầu bởi", value: interaction.user.tag, inline: true },
              )
            ],
          });
        }

        // Join voice channel
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
        });

        if (!S.musicPlaying[gid]) S.musicPlaying[gid] = {};
        S.musicPlaying[gid].connection = connection;

        const player = createAudioPlayer();
        connection.subscribe(player);
        S.musicPlaying[gid].player = player;

        // Xử lý khi connection bị ngắt
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
          } catch {
            connection.destroy();
            delete S.musicPlaying[gid];
            delete S.musicQueue[gid];
          }
        });

        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xff0000)
            .setTitle("🎵 Đã vào voice — Bắt đầu phát!")
            .setDescription(`**[${title}](${link})**`)
            .addFields(
              { name: "Voice Channel", value: voiceChannel.name, inline: true },
              { name: "Yêu cầu bởi", value: interaction.user.tag, inline: true },
            )
            .setTimestamp()
          ],
        });

        // Bắt đầu phát
        playNext(gid, interaction.channel);

      } catch (err) {
        console.error("/play error:", err);
        return interaction.editReply({ content: `❌ Lỗi: ${err.message}` });
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /stop
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "stop") {
      const conn = getVoiceConnection(gid);
      if (!conn) return interaction.reply({ content: "❌ Bot không đang ở trong voice channel nào!", flags: 64 });

      S.musicQueue[gid] = [];
      S.musicPlaying[gid]?.player?.stop();
      conn.destroy();
      delete S.musicPlaying[gid];

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xed4245)
          .setTitle("⏹️ Đã dừng phát nhạc")
          .setDescription("Bot đã rời voice channel và xoá hàng chờ.")
        ],
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /skip
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "skip") {
      const playing = S.musicPlaying[gid];
      if (!playing?.player) return interaction.reply({ content: "❌ Không có bài nào đang phát!", flags: 64 });

      const current = playing.current;
      S.musicQueue[gid]?.shift();
      playing.player.stop(); // trigger Idle → playNext tự chạy

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xfee75c)
          .setTitle("⏭️ Đã bỏ qua bài")
          .setDescription(current ? `**${current.title}**` : "Bài không xác định")
          .setFooter({ text: `Còn ${Math.max(0, (S.musicQueue[gid]?.length || 0))} bài trong queue` })
        ],
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /pause
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "pause") {
      const player = S.musicPlaying[gid]?.player;
      if (!player) return interaction.reply({ content: "❌ Không có bài nào đang phát!", flags: 64 });
      player.pause();
      return interaction.reply({ content: "⏸️ Đã **tạm dừng** phát nhạc." });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /resume
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "resume") {
      const player = S.musicPlaying[gid]?.player;
      if (!player) return interaction.reply({ content: "❌ Không có bài nào đang phát!", flags: 64 });
      player.unpause();
      return interaction.reply({ content: "▶️ Đã **tiếp tục** phát nhạc." });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /queue
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "queue") {
      const queue = S.musicQueue[gid] || [];
      const playing = S.musicPlaying[gid]?.current;

      if (!playing && queue.length === 0) {
        return interaction.reply({ content: "📋 Hàng chờ nhạc đang trống!", flags: 64 });
      }

      const queueList = queue.slice(0, 10).map((item, i) =>
        `**${i + 1}.** [${item.title}](${item.url}) — *${item.requestedBy}*`
      ).join("\n");

      const embed = new EmbedBuilder().setColor(0x5865f2)
        .setTitle("📋 Hàng chờ nhạc")
        .addFields(
          { name: "🎵 Đang phát", value: playing ? `[${playing.title}](${playing.url})` : "Không có" },
          { name: `⏳ Tiếp theo (${queue.length} bài)`, value: queueList || "Trống" },
        )
        .setFooter({ text: queue.length > 10 ? `...và ${queue.length - 10} bài nữa` : "" });

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /kick
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "kick") {
      const target = interaction.options.getMember("user");
      const reason = interaction.options.getString("ly_do") || "Không có lý do";
      if (!target?.kickable) return interaction.reply({ content: "❌ Không thể kick người này!", flags: 64 });
      await target.kick(reason);
      await sendLog(guild, new EmbedBuilder().setColor(0xff6600).setTitle("👢 KICK")
        .addFields(
          { name: "Người bị kick", value: `${target.user.tag} (<@${target.id}>)`, inline: true },
          { name: "Mod", value: `${interaction.user.tag}`, inline: true },
          { name: "Lý do", value: reason },
        ).setTimestamp());
      return interaction.reply({ content: `✅ Đã kick **${target.user.tag}** — Lý do: ${reason}`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /ban
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "ban") {
      const target = interaction.options.getMember("user");
      const reason = interaction.options.getString("ly_do") || "Không có lý do";
      if (!target?.bannable) return interaction.reply({ content: "❌ Không thể ban người này!", flags: 64 });
      await target.ban({ reason });
      await sendLog(guild, new EmbedBuilder().setColor(0xed4245).setTitle("🔨 BAN")
        .addFields(
          { name: "Người bị ban", value: `${target.user.tag} (<@${target.id}>)`, inline: true },
          { name: "Mod", value: `${interaction.user.tag}`, inline: true },
          { name: "Lý do", value: reason },
        ).setTimestamp());
      return interaction.reply({ content: `✅ Đã ban **${target.user.tag}** — Lý do: ${reason}`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /mute
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "mute") {
      const target = interaction.options.getMember("user");
      const timeStr = interaction.options.getString("thoi_gian");
      const reason = interaction.options.getString("ly_do") || "Không có lý do";
      const dur = parseDuration(timeStr);
      if (!dur) return interaction.reply({ content: "❌ Thời gian không hợp lệ! VD: `10m` `1h` `2d`", flags: 64 });
      if (dur > 28 * 86400000) return interaction.reply({ content: "❌ Discord giới hạn mute tối đa 28 ngày!", flags: 64 });
      await target.timeout(Math.max(1000, dur), reason);
      await sendLog(guild, new EmbedBuilder().setColor(0xffa500).setTitle("🔇 MUTE")
        .addFields(
          { name: "Người bị mute", value: `${target.user.tag} (<@${target.id}>)`, inline: true },
          { name: "Thời gian", value: timeStr, inline: true },
          { name: "Mod", value: `${interaction.user.tag}`, inline: true },
          { name: "Lý do", value: reason },
        ).setTimestamp());
      return interaction.reply({ content: `✅ Đã mute **${target.user.tag}** trong **${timeStr}** — Lý do: ${reason}`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /unmute
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "unmute") {
      const target = interaction.options.getMember("user");
      await target.timeout(null);
      await sendLog(guild, new EmbedBuilder().setColor(0x57f287).setTitle("🔊 UNMUTE")
        .addFields(
          { name: "Người được bỏ mute", value: `${target.user.tag}`, inline: true },
          { name: "Mod", value: `${interaction.user.tag}`, inline: true },
        ).setTimestamp());
      return interaction.reply({ content: `✅ Đã bỏ mute **${target.user.tag}**`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /clear
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "clear") {
      const amount = interaction.options.getInteger("so_luong");
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await sendLog(guild, new EmbedBuilder().setColor(0x99aab5).setTitle("🗑️ CLEAR")
        .addFields(
          { name: "Số tin đã xoá", value: `${deleted.size}`, inline: true },
          { name: "Kênh", value: `<#${interaction.channel.id}>`, inline: true },
          { name: "Mod", value: `${interaction.user.tag}`, inline: true },
        ).setTimestamp());
      return interaction.reply({ content: `✅ Đã xoá **${deleted.size}** tin nhắn trong <#${interaction.channel.id}>`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /warn
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "warn") {
      const target = interaction.options.getMember("user");
      const reason = interaction.options.getString("ly_do");
      if (!S.warns[gid]) S.warns[gid] = {};
      if (!S.warns[gid][target.id]) S.warns[gid][target.id] = 0;
      S.warns[gid][target.id]++;
      const count = S.warns[gid][target.id];

      if (count >= 3) {
        await target.timeout(30 * 60 * 1000, `Tích lũy ${count} cảnh cáo`).catch(() => { });
        await interaction.channel.send(`⚠️ <@${target.id}> đã nhận **${count} cảnh cáo** → **Tự động mute 30 phút!**`);
      }

      await sendLog(guild, new EmbedBuilder().setColor(0xffa500).setTitle("⚠️ WARN")
        .addFields(
          { name: "Người bị cảnh cáo", value: `${target.user.tag}`, inline: true },
          { name: "Số lần", value: `${count}/3`, inline: true },
          { name: "Mod", value: `${interaction.user.tag}`, inline: true },
          { name: "Lý do", value: reason },
        ).setTimestamp());

      return interaction.reply({
        content: `⚠️ Đã cảnh cáo **${target.user.tag}** (${count}/3) — Lý do: ${reason}` +
          (count >= 3 ? "\n🔇 **Đã mute tự động 30 phút do đủ 3 cảnh cáo!**" : ""),
        flags: 64,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /warnlist
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "warnlist") {
      const target = interaction.options.getMember("user");
      const count = S.warns[gid]?.[target.id] || 0;
      const status = count === 0 ? "✅ Chưa có cảnh cáo" : count >= 3 ? "🔴 Đã đủ 3 — bị mute" : count === 2 ? "🟠 2/3 — cần chú ý" : "🟡 1/3 — bình thường";
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(count >= 3 ? 0xed4245 : 0xffa500)
          .setTitle(`⚠️ Cảnh cáo: ${target.user.tag}`)
          .addFields(
            { name: "Số lần cảnh cáo", value: `**${count}/3**`, inline: true },
            { name: "Trạng thái", value: status, inline: true },
          )
        ],
        flags: 64,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /warnreset
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "warnreset") {
      const target = interaction.options.getMember("user");
      if (S.warns[gid]) S.warns[gid][target.id] = 0;
      return interaction.reply({ content: `✅ Đã xoá cảnh cáo của **${target.user.tag}**`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /anti
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "anti") {
      const tf = interaction.options.getString("tinh_nang");
      const st = interaction.options.getString("trang_thai");
      const henBat = interaction.options.getString("hen_gio_bat");
      const henTat = interaction.options.getString("hen_gio_tat");

      if (!S.anti[gid]) S.anti[gid] = { link: false, invite: false, spam: false };

      // Xem trạng thái
      if (tf === "status") {
        const a = S.anti[gid];
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Trạng thái Anti hiện tại")
            .addFields(
              { name: "🔗 Anti Link", value: a.link ? "✅ Đang bật" : "❌ Đang tắt", inline: true },
              { name: "📨 Anti Invite", value: a.invite ? "✅ Đang bật" : "❌ Đang tắt", inline: true },
              { name: "💬 Anti Spam", value: a.spam ? "✅ Đang bật" : "❌ Đang tắt", inline: true },
            )],
          flags: 64,
        });
      }

      const typeMap = { link: "link", invite: "invite", spam: "spam" };
      const key = typeMap[tf];
      if (!key) return interaction.reply({ content: "❌ Tính năng không hợp lệ!", flags: 64 });

      let replyMsg = "";

      // Hẹn giờ BẬT
      if (henBat) {
        const delay = parseDuration(henBat);
        if (!delay) return interaction.reply({ content: "❌ Thời gian hẹn giờ không hợp lệ!", flags: 64 });
        setTimeout(() => {
          if (!S.anti[gid]) S.anti[gid] = {};
          S.anti[gid][key] = true;
          guild.channels.cache.get(S.logCh[gid])?.send(`🕐 Hẹn giờ: **Anti ${tf}** đã tự động **BẬT** sau ${henBat}`).catch(() => { });
        }, delay);
        replyMsg += `⏰ Anti **${tf}** sẽ tự động **BẬT** sau **${henBat}**\n`;
      }

      // Hẹn giờ TẮT
      if (henTat) {
        const delay = parseDuration(henTat);
        if (!delay) return interaction.reply({ content: "❌ Thời gian hẹn giờ không hợp lệ!", flags: 64 });
        setTimeout(() => {
          if (!S.anti[gid]) S.anti[gid] = {};
          S.anti[gid][key] = false;
          guild.channels.cache.get(S.logCh[gid])?.send(`🕐 Hẹn giờ: **Anti ${tf}** đã tự động **TẮT** sau ${henTat}`).catch(() => { });
        }, delay);
        replyMsg += `⏰ Anti **${tf}** sẽ tự động **TẮT** sau **${henTat}**\n`;
      }

      // Bật/tắt ngay
      if (st) {
        S.anti[gid][key] = st === "on";
        replyMsg += `${st === "on" ? "✅ Đã **bật**" : "❌ Đã **tắt**"} **Anti ${tf}**`;
        await sendLog(guild, new EmbedBuilder().setColor(st === "on" ? 0x57f287 : 0xed4245)
          .setTitle(`🛡️ Anti ${tf} ${st === "on" ? "BẬT" : "TẮT"}`)
          .addFields({ name: "Admin", value: interaction.user.tag })
          .setTimestamp());
      }

      if (!replyMsg) replyMsg = "ℹ️ Không có thay đổi nào được thực hiện.";
      return interaction.reply({ content: replyMsg, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /setlog
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "setlog") {
      const ch = interaction.options.getChannel("kenh");
      S.logCh[gid] = ch.id;
      return interaction.reply({ content: `✅ Kênh log moderation đã được đặt: <#${ch.id}>`, flags: 64 });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /serverhealth
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "serverhealth") {
      await interaction.deferReply({ flags: 64 });
      try { await guild.members.fetch(); } catch { }

      const members = guild.memberCount;
      const bots = guild.members.cache.filter(m => m.user.bot).size;
      const humans = members - bots;

      const w7 = Date.now() - 7 * 86400000;
      const joins7 = (S.joinLog[gid] || []).filter(t => t > w7).length;
      const leaves7 = (S.leaveLog[gid] || []).filter(t => t > w7).length;
      const netGrowth = joins7 - leaves7;

      const todayStr = today();
      const ydayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const mToday = S.msgLog[gid]?.[todayStr] || 0;
      const mYday = S.msgLog[gid]?.[ydayStr] || 0;

      // Top 3 kênh sôi động
      const chLog = S.chMsgLog[gid] || {};
      const topChs = Object.entries(chLog)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 3)
        .map(([id, v]) => `<#${id}>: **${v.count}** tin`);

      // Kênh chết (7 ngày không có tin)
      const deadChs = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .filter(c => !chLog[c.id] || chLog[c.id].lastMsg < w7)
        .map(c => `<#${c.id}>`)
        .slice(0, 5);

      const healthIcon = netGrowth > 0 ? "📈" : netGrowth < 0 ? "📉" : "➡️";
      const healthText = netGrowth > 0 ? "Server đang tăng trưởng!" : netGrowth < 0 ? "Server đang giảm thành viên." : "Server ổn định.";

      const embed = new EmbedBuilder().setColor(netGrowth >= 0 ? 0x57f287 : 0xed4245)
        .setTitle(`📊 Sức khoẻ Server: ${guild.name}`)
        .addFields(
          { name: `${healthIcon} Tình trạng`, value: healthText, inline: false },
          { name: "👥 Thành viên", value: `**${humans}** người + **${bots}** bot = **${members}** tổng`, inline: false },
          { name: "📈 7 ngày qua", value: `+${joins7} join · -${leaves7} rời · Net: **${netGrowth > 0 ? "+" : ""}${netGrowth}**`, inline: false },
          { name: "💬 Tin nhắn hôm nay", value: `**${mToday}** (hôm qua: ${mYday})`, inline: true },
          { name: "🏗️ Cấu trúc", value: `${guild.channels.cache.size} kênh · ${guild.roles.cache.size} role`, inline: true },
          { name: "🔥 Top kênh sôi động", value: topChs.length ? topChs.join("\n") : "Chưa có dữ liệu (bot mới khởi động)", inline: false },
          { name: "💀 Kênh không hoạt động 7 ngày", value: deadChs.length ? deadChs.join(", ") : "✅ Tất cả kênh đang có hoạt động", inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Dữ liệu tính từ lúc bot khởi động" });

      return interaction.editReply({ embeds: [embed] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /rolescan
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "rolescan") {
      await interaction.deferReply({ flags: 64 });
      try { await guild.members.fetch(); } catch { }

      const roles = guild.roles.cache.filter(r => r.id !== guild.id);
      const emptyRoles = [];
      const dangerRoles = [];
      const warnings = [];

      for (const [, r] of roles) {
        const count = guild.members.cache.filter(m => m.roles.cache.has(r.id)).size;
        if (count === 0) emptyRoles.push(r.name);
        if (r.permissions.has(PermissionFlagsBits.Administrator))
          dangerRoles.push(`🔴 **${r.name}** — có quyền Administrator (${count} người)`);
        else if (r.permissions.has(PermissionFlagsBits.BanMembers) && count === 0)
          warnings.push(`🟠 **${r.name}** — có quyền Ban nhưng không ai dùng`);
        else if (r.permissions.has(PermissionFlagsBits.ManageGuild) && count === 0)
          warnings.push(`🟡 **${r.name}** — có quyền Manage Server nhưng không ai dùng`);
      }

      const embed = new EmbedBuilder().setColor(0xffa500).setTitle("👥 ROLE SCAN")
        .addFields(
          { name: `🚮 Role không có ai dùng (${emptyRoles.length})`, value: emptyRoles.slice(0, 15).join(", ") || "✅ Không có" },
          { name: `⚠️ Role nguy hiểm (${dangerRoles.length})`, value: dangerRoles.slice(0, 8).join("\n") || "✅ Không có" },
          { name: `🔍 Cảnh báo quyền thừa (${warnings.length})`, value: warnings.slice(0, 8).join("\n") || "✅ Không có" },
          { name: "💡 Khuyến nghị", value: emptyRoles.length > 3 ? `Cân nhắc xoá ${emptyRoles.length} role trống để server gọn hơn.` : "Server đang có cấu trúc role hợp lý ✅" },
        )
        .setFooter({ text: `Tổng: ${roles.size} role | Quét lúc ${new Date().toLocaleString("vi-VN")}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /permscan
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "permscan") {
      await interaction.deferReply({ flags: 64 });
      const warnings = [];

      guild.roles.cache.forEach(r => {
        if (r.id === guild.id) return;
        if (r.permissions.has(PermissionFlagsBits.Administrator))
          warnings.push(`🔴 Role **${r.name}** có quyền **Administrator** — quyền cao nhất, có thể làm mọi thứ!`);
        if (r.permissions.has(PermissionFlagsBits.ManageGuild))
          warnings.push(`🟠 Role **${r.name}** có quyền **Manage Server**`);
        if (r.permissions.has(PermissionFlagsBits.BanMembers))
          warnings.push(`🟡 Role **${r.name}** có quyền **Ban Members**`);
        if (r.permissions.has(PermissionFlagsBits.ManageRoles))
          warnings.push(`🟡 Role **${r.name}** có quyền **Manage Roles** — có thể tạo/xoá role`);
      });

      guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .forEach(ch => {
          const everyPerm = ch.permissionOverwrites.cache.get(guild.id);
          if (everyPerm?.allow.has(PermissionFlagsBits.SendMessages))
            warnings.push(`🟡 Kênh **#${ch.name}** cho **@everyone** gửi tin nhắn — nên xem xét lại`);
          if (everyPerm?.allow.has(PermissionFlagsBits.ManageMessages))
            warnings.push(`🔴 Kênh **#${ch.name}** cho **@everyone** xoá tin nhắn — RẤT NGUY HIỂM!`);
        });

      const embed = new EmbedBuilder()
        .setColor(warnings.length === 0 ? 0x57f287 : warnings.some(w => w.startsWith("🔴")) ? 0xed4245 : 0xffa500)
        .setTitle("🔐 PERMISSION SCAN — Kết quả quét quyền")
        .setDescription(
          warnings.length
            ? warnings.slice(0, 15).join("\n")
            : "✅ Không phát hiện vấn đề bảo mật nghiêm trọng. Server đang an toàn!"
        )
        .addFields(
          { name: "📊 Tổng cảnh báo", value: `${warnings.length} vấn đề`, inline: true },
          { name: "🔴 Nghiêm trọng", value: `${warnings.filter(w => w.startsWith("🔴")).length}`, inline: true },
          { name: "🟡 Cần chú ý", value: `${warnings.filter(w => w.startsWith("🟡")).length}`, inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /backup
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "backup") {
      const action = interaction.options.getString("hanh_dong");

      if (action === "save") {
        await interaction.deferReply({ flags: 64 });
        const cats = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position)
          .map(c => ({ id: c.id, name: c.name, position: c.position }));
        const channels = guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position)
          .map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, position: c.position, topic: c.topic || null, nsfw: c.nsfw || false, bitrate: c.bitrate || null, userLimit: c.userLimit || null, rateLimitPerUser: c.rateLimitPerUser || 0 }));
        const roles = guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).sort((a, b) => a.position - b.position)
          .map(r => ({ id: r.id, name: r.name, color: r.color, hexColor: r.hexColor, permissions: r.permissions.bitfield.toString(), position: r.position, hoist: r.hoist, mentionable: r.mentionable }));
        const snapshot = { guildName: guild.name, guildId: gid, savedAt: new Date().toISOString(), cats, channels, roles };
        S.backup[gid] = snapshot;
        // Lưu ra file để không mất khi bot restart
        try {
          fs.writeFileSync(path.join(__dirname, `backup_${gid}.json`), JSON.stringify(snapshot, null, 2), "utf-8");
        } catch (e) { console.error("Lỗi ghi file backup:", e.message); }

        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("💾 BACKUP THÀNH CÔNG — Mức 2")
            .addFields(
              { name: "🏠 Server", value: guild.name, inline: true },
              { name: "📂 Category", value: `${cats.length}`, inline: true },
              { name: "📁 Kênh", value: `${channels.length}`, inline: true },
              { name: "👥 Role", value: `${roles.length}`, inline: true },
              { name: "🕐 Lưu lúc", value: new Date().toLocaleString("vi-VN"), inline: true },
            )
            .setDescription("✅ Đã lưu vào RAM và file **backup_" + gid + ".json**\n♻️ Dùng **/restore** trong server mới để khôi phục!\n💡 Dữ liệu **KHÔNG MẤT** khi bot restart!")
            .setTimestamp()],
        });
      }

      if (action === "view") {
        // Ưu tiên RAM, nếu không có thì đọc từ file
        if (!S.backup[gid]) {
          const f = path.join(__dirname, `backup_${gid}.json`);
          if (fs.existsSync(f)) {
            try { S.backup[gid] = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { }
          }
        }
        const bk = S.backup[gid];
        if (!bk) return interaction.reply({ content: "❌ Chưa có backup nào! Dùng `/backup save` trước.", flags: 64 });

        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📦 THÔNG TIN BACKUP")
          .addFields(
            { name: "🏠 Server lúc backup", value: bk.guildName, inline: true },
            { name: "📂 Category", value: `${bk.cats?.length || 0}`, inline: true },
            { name: "📁 Số kênh", value: `${bk.channels.length}`, inline: true },
            { name: "👥 Số role", value: `${bk.roles.length}`, inline: true },
            { name: "🕐 Lưu lúc", value: new Date(bk.savedAt).toLocaleString("vi-VN"), inline: true },
            { name: "📝 Kênh đã backup (20 đầu)", value: bk.channels.slice(0, 20).map(c => c.name).join(", ") || "Không có" },
            { name: "🎨 Role đã backup", value: bk.roles.slice(0, 15).map(r => `${r.name}(${r.hexColor || r.color})`).join(", ") || "Không có" },
          )
          .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /restore — Khôi phục server từ backup (tạo lại kênh + role)
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "restore") {
      const confirm = interaction.options.getString("xac_nhan");
      if (confirm !== "CONFIRM") return interaction.reply({ content: "❌ Gõ đúng **CONFIRM** (viết hoa) để xác nhận!", flags: 64 });

      // Load backup: ưu tiên RAM, rồi file của server này, rồi file mới nhất
      let bk = S.backup[gid] || null;
      if (!bk) {
        const f = path.join(__dirname, `backup_${gid}.json`);
        if (fs.existsSync(f)) try { bk = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { }
      }
      if (!bk) {
        try {
          const files = fs.readdirSync(__dirname).filter(fn => fn.startsWith("backup_") && fn.endsWith(".json"));
          if (files.length) {
            const latest = files.sort((a, b) => fs.statSync(path.join(__dirname, b)).mtime - fs.statSync(path.join(__dirname, a)).mtime)[0];
            bk = JSON.parse(fs.readFileSync(path.join(__dirname, latest), "utf-8"));
          }
        } catch { }
      }
      if (!bk) return interaction.reply({ content: "❌ Không tìm thấy backup nào!\n💡 Dùng **/backup save** trong server gốc trước.", flags: 64 });

      await interaction.deferReply({});
      const res = { roles: 0, cats: 0, channels: 0, errors: [] };
      const catIdMap = {};

      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("♻️ ĐANG KHÔI PHỤC...")
          .setDescription(`Nguồn: **${bk.guildName}** (${new Date(bk.savedAt).toLocaleString("vi-VN")})\n\n⏳ Đang tạo **${bk.roles.length}** role...\n⏳ Đang tạo **${bk.cats?.length || 0}** category...\n⏳ Đang tạo **${bk.channels.length}** kênh...\n\nVui lòng chờ...`)
        ],
      });

      // BƯỚC 1: Tạo Role
      for (const r of bk.roles) {
        try {
          await guild.roles.create({ name: r.name, color: r.color || 0, permissions: BigInt(r.permissions), hoist: r.hoist || false, mentionable: r.mentionable || false, reason: "Restore backup" });
          res.roles++;
          await new Promise(ok => setTimeout(ok, 350));
        } catch (e) { res.errors.push(`Role "${r.name}": ${e.message}`); }
      }

      // BƯỚC 2: Tạo Category
      for (const cat of (bk.cats || [])) {
        try {
          const newCat = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, position: cat.position, reason: "Restore backup" });
          catIdMap[cat.id] = newCat.id;
          res.cats++;
          await new Promise(ok => setTimeout(ok, 350));
        } catch (e) { res.errors.push(`Category "${cat.name}": ${e.message}`); }
      }

      // BƯỚC 3: Tạo Kênh
      for (const ch of bk.channels) {
        try {
          const opts = { name: ch.name, type: ch.type, position: ch.position, reason: "Restore backup" };
          if (ch.parentId && catIdMap[ch.parentId]) opts.parent = catIdMap[ch.parentId];
          if (ch.type === ChannelType.GuildText) {
            if (ch.topic) opts.topic = ch.topic;
            if (ch.nsfw) opts.nsfw = ch.nsfw;
            if (ch.rateLimitPerUser) opts.rateLimitPerUser = ch.rateLimitPerUser;
          }
          if (ch.type === ChannelType.GuildVoice) {
            if (ch.bitrate) opts.bitrate = Math.min(ch.bitrate, 96000);
            if (ch.userLimit) opts.userLimit = ch.userLimit;
          }
          await guild.channels.create(opts);
          res.channels++;
          await new Promise(ok => setTimeout(ok, 350));
        } catch (e) { res.errors.push(`Kênh "${ch.name}": ${e.message}`); }
      }

      // KẾT QUẢ
      const errText = res.errors.length
        ? res.errors.slice(0, 5).join("\n") + (res.errors.length > 5 ? `\n...và ${res.errors.length - 5} lỗi khác` : "")
        : "✅ Không có lỗi";
      const resultEmbed = new EmbedBuilder()
        .setColor(res.errors.length === 0 ? 0x57f287 : 0xffa500)
        .setTitle("♻️ KHÔI PHỤC HOÀN TẤT!")
        .setDescription(`Nguồn: **${bk.guildName}** → Đích: **${guild.name}**`)
        .addFields(
          { name: "✅ Role đã tạo", value: `${res.roles}/${bk.roles.length}`, inline: true },
          { name: "✅ Category đã tạo", value: `${res.cats}/${bk.cats?.length || 0}`, inline: true },
          { name: "✅ Kênh đã tạo", value: `${res.channels}/${bk.channels.length}`, inline: true },
          { name: "⚠️ Lỗi", value: errText },
        )
        .setTimestamp()
        .setFooter({ text: "Kiểm tra lại server sau khi restore!" });
      await sendLog(guild, resultEmbed);
      return interaction.editReply({ embeds: [resultEmbed] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  /exporttemplate
    // ════════════════════════════════════════════════════════════════════════
    if (cmd === "exporttemplate") {
      await interaction.deferReply({ flags: 64 });

      const cats = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
      const textChs = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).sort((a, b) => a.position - b.position);
      const voiceChs = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).sort((a, b) => a.position - b.position);
      const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);

      let txt = `╔══════════════════════════════════════╗\n`;
      txt += `║  TEMPLATE SERVER: ${guild.name.slice(0, 20).padEnd(20)} ║\n`;
      txt += `║  Xuất lúc: ${new Date().toLocaleString("vi-VN").slice(0, 27)} ║\n`;
      txt += `╚══════════════════════════════════════╝\n\n`;
      txt += `📊 THỐNG KÊ: ${guild.memberCount} thành viên · ${guild.channels.cache.size} kênh · ${guild.roles.cache.size} role\n\n`;
      txt += `${"─".repeat(42)}\n`;
      txt += `📁 CẤU TRÚC KÊNH:\n${"─".repeat(42)}\n`;

      cats.forEach(cat => {
        txt += `\n📂 [${cat.name.toUpperCase()}]\n`;
        textChs.filter(c => c.parentId === cat.id).forEach(c => { txt += `   💬 #${c.name}\n`; });
        voiceChs.filter(c => c.parentId === cat.id).forEach(c => { txt += `   🔊 ${c.name}\n`; });
      });

      const noCategory = textChs.filter(c => !c.parentId);
      if (noCategory.size) {
        txt += `\n📌 [KHÔNG CÓ CATEGORY]\n`;
        noCategory.forEach(c => { txt += `   💬 #${c.name}\n`; });
      }

      txt += `\n${"─".repeat(42)}\n`;
      txt += `👥 DANH SÁCH ROLE:\n${"─".repeat(42)}\n`;
      roles.forEach(r => { txt += `• ${r.name.padEnd(25)} ${r.hexColor}\n`; });

      const buf = Buffer.from(txt, "utf-8");
      return interaction.editReply({
        content: `✅ Template server **${guild.name}** đã được xuất thành công!`,
        files: [{ attachment: buf, name: `template_${guild.name.replace(/[^a-z0-9]/gi, "_")}.txt` }],
      });
    }
  } catch (err) {
    // Bắt lỗi interaction hết hạn hoặc các lỗi Discord API
    if (err?.code === 10062) return; // Unknown interaction - đã hết hạn, bỏ qua
    console.error("Interaction error:", err?.message || err);
    // Thử reply lỗi nếu interaction còn hiệu lực
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "❌ Đã xảy ra lỗi!", flags: 64 }).catch(() => { });
      } else {
        await interaction.reply({ content: "❌ Đã xảy ra lỗi!", flags: 64 }).catch(() => { });
      }
    } catch { }
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GLOBAL ERROR HANDLER
// ════════════════════════════════════════════════════════════════════════════
process.on("unhandledRejection", err => {
  // Bỏ qua lỗi Unknown Interaction (10062) - interaction đã hết hạn
  if (err?.code === 10062) return;
  console.error("Unhandled rejection:", err?.message || err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught exception:", err?.message || err);
  // Không thoát bot khi có lỗi nhỏ
});

// ════════════════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════════════════
client.login(TOKEN);