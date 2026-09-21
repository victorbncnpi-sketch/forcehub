// Dublê de api/_auth.js para os testes.
//
// As funções de REGRA (permissões, papéis) são reexportadas do arquivo real —
// nunca copiadas. Uma cópia daria a ilusão de cobertura: os testes de permissão
// continuariam verdes depois de alguém afrouxar a regra em produção. Só sessão
// e cadastro de usuários são substituídos, porque são justamente o que o teste
// precisa controlar.
export {
  PAGE_CAPS, DEFAULT_CLIENT_PERMS, SUPERADMIN, ROLES,
  isStaff, effectivePerms, sessionCan, publicUser, isExpired,
  hashPassword, verifyPassword, generatePassword, normalizeEmail, EMAIL_RE,
} from "../../api/_auth.js";

export async function getSession() { return globalThis.__SESSION__ || null; }
export async function getUsers() { return globalThis.__USERS__ || {}; }
export async function saveUsers(mapa) { globalThis.__USERS__ = mapa; }
