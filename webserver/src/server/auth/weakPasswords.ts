/**
 * Weak-password denylist.
 *
 * Not a security control on its own — length plus a similarity check does the
 * heavy lifting (NIST 800-63B). This list stops the handful of passwords that
 * are guaranteed to be tried first by any credential-stuffing run.
 *
 * Additions are cheap and welcome; removals need a reason.
 */

const EXPLICIT = [
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd',
  'p@ssw0rd', 'p@ssword', 'pa$$word', 'pass1234', 'password!', 'password@123',
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345678901',
  '0123456789', '0987654321', '11111111', '111111111', '1111111111', '00000000',
  '12341234', '12121212', '123123123', '11223344', '987654321', '87654321',
  'qwerty', 'qwerty1', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyuiop',
  '1qaz2wsx', '1qaz2wsx3edc', 'qazwsx', 'qazwsxedc', 'zxcvbnm', 'zxcvbnm123',
  'asdfgh', 'asdfghjkl', 'asdf1234', 'asdfasdf', 'abc123', 'abc12345', 'abcd1234',
  'a1b2c3d4', 'aa123456', 'aaaaaaaa', 'aaaa1111', 'iloveyou', 'iloveyou1',
  'admin', 'admin123', 'admin1234', 'administrator', 'adminadmin', 'rootroot',
  'letmein', 'letmein1', 'welcome', 'welcome1', 'welcome123', 'welcome2024',
  'monkey', 'monkey123', 'dragon', 'dragon123', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'batman123', 'starwars', 'whatever', 'trustno1',
  'master', 'master123', 'shadow', 'shadow123', 'michael', 'jennifer', 'jordan23',
  'super123', 'superuser', 'changeme', 'changeme123', 'secret123', 'secretkey',
  'test1234', 'testtest', 'testing123', 'temp1234', 'demo1234', 'guest123',
  'login123', 'user1234', 'newuser123', 'mypassword', 'mypassword123',
  'ecliptrix', 'ecliptrix123', 'adminjr', 'adminjr1', 'company123',
  'google123', 'facebook1', 'linkedin1', 'instagram', 'twitter123',
  'qq123456', 'qq123456789', 'aa123456789', 'woaini1314', 'woaini520',
  '5201314', '1314520', '5211314', 'aishiteru', 'woaiwojia', 'zhangwei123',
  'wangwei123', 'liwei123', 'lisi1234', 'zhangsan', 'zhangsan123', 'lisi', 'wangwu',
  'password12345', 'password123456', 'password2024', 'password2025', 'password2026',
  'ecliptrix2024', 'ecliptrix2025', 'ecliptrix2026', 'woshishuaige', 'nihao123',
  'nihao1234', 'hello1234', 'helloworld', 'helloworld1', 'hellothere',
  'goodluck', 'goodluck123', 'nothing123', 'unknown123', 'default123',
  'matrix123', 'nebula123', 'galaxy123', 'quantum123', 'october2024',
  'january2025', 'february2025', 'spring2025', 'summer2025', 'winter2025',
  'autumn2025', 'abcd123456', 'abcabcabc', 'aaaaaa1111', 'zaq12wsx', 'xsw2zaq1',
  'qwe123asd', 'asd123qwe', 'zxc123vbn', 'mkoijn123', '1q2w3e4r', '1q2w3e4r5t',
  '1q2w3e4r5t6y', '1qazxsw2', 'password1!', 'password!1', 'changeme!1',
  'windows123', 'macbook123', 'keyboard1', 'computer1', 'internet1',
  'samsung123', 'iphone1234', 'android123', 'telephone', 'tianya123',
  'michelle', 'nicole123', 'jessica123', 'charles123', 'andrew123', 'daniel123',
  'sophie123', 'matthew1', 'anthony123', 'william123', 'richard123',
]

/** Short, extremely common strings that a length rule alone would let through. */
const GENERATED_SUFFIXES = ['', '1', '12', '123', '1234', '2024', '2025', '2026']

function build(): ReadonlySet<string> {
  const set = new Set<string>()
  for (const entry of EXPLICIT) set.add(entry)
  for (const base of ['password', 'admin', 'qwerty', 'ecliptrix', 'welcome', 'abc', 'test']) {
    for (const suffix of GENERATED_SUFFIXES) set.add(`${base}${suffix}`)
  }
  for (let year = 1980; year <= 2027; year += 1) {
    set.add(String(year))
    set.add(`${year}${year}`)
  }
  for (let run = 4; run <= 20; run += 1) {
    set.add('1'.repeat(run))
    set.add('0'.repeat(run))
    set.add('a'.repeat(run))
    set.add('9'.repeat(run))
  }
  return set
}

export const WEAK_PASSWORDS: ReadonlySet<string> = build()

/** Case-insensitive membership test used by the policy check. */
export function isWeakPassword(password: string): boolean {
  return WEAK_PASSWORDS.has(password.toLowerCase())
}
