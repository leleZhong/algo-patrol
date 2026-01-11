const input = document.getElementById("idInput");
const aliasInput = document.getElementById("aliasInput"); // 없으면 null
const groupInput = document.getElementById("groupInput"); // 없으면 null
const btn = document.getElementById("addBtn");
const list = document.getElementById("resultList");
const dateInfo = document.getElementById("dateInfo");
const DEFAULT_GROUP_NAME = "기본";

/* ───────────────── 유틸: storage Promise 래퍼 ───────────────── */
// sync와 local을 모두 확인하여 데이터 유실 방지
async function getUsers() {
    return new Promise((resolve) => {
        // 1. 먼저 sync 데이터 가져옴
        chrome.storage.sync.get({ users: [] }, (syncRes) => {
            if (syncRes.users && syncRes.users.length > 0) {
                resolve(syncRes.users);
            } else {
                // 2. sync가 비어있다면 기기 변경 직후이거나 첫 설치일 수 있으므로 local 확인
                chrome.storage.local.get({ users: [] }, (localRes) => {
                    resolve(localRes.users);
                });
            }
        });
    });
}

async function setUsers(users) {
    // 빈 배열이나 잘못된 데이터로 덮어쓰는 것을 방지하기 위한 안전장치
    if (!Array.isArray(users)) return;

    return new Promise((resolve) => {
        // sync에 저장 (기기 간 동기화)
        chrome.storage.sync.set({ users }, () => {
            // local에도 백업으로 저장 (오프라인 및 유실 대비)
            chrome.storage.local.set({ users }, resolve);
        });
    });
}

/* ──────────────── 데이터 마이그레이션: Local -> Sync 및 스키마 변환 ──────────────── */
async function migrateToSync() {
    const localData = await new Promise(r => chrome.storage.local.get({ users: [] }, r));
    const syncData = await new Promise(r => chrome.storage.sync.get({ users: [] }, r));

    let finalUsers = [];

    // 1. sync에 데이터가 이미 있다면 그것을 우선 사용
    if (syncData.users && syncData.users.length > 0) {
        finalUsers = syncData.users;
    } 
    // 2. sync는 비었지만 local에 데이터가 있다면 이관 진행
    else if (localData.users && localData.users.length > 0) {
        finalUsers = localData.users;
    }

    // 3. 기존 문자열 배열 형태(["id1", "id2"])라면 객체 형태로 변환 (기존 코드의 로직 유지)
    if (finalUsers.length > 0 && typeof finalUsers[0] === "string") {
        finalUsers = finalUsers.map((h) => ({
            handle: h,
            alias: "",
            group: DEFAULT_GROUP_NAME,
            reverseStreak: 0,
            lastSolvedDate: null,
            lastCheckedDate: null,
            todayCount: 0,
        }));
    }

    // 4. 결과가 있다면 양쪽 저장소 동기화
    if (finalUsers.length > 0) {
        await setUsers(normalizeUsers(finalUsers));
    }
}

/* ──────────────── 날짜 유틸 (solved.ac 06:00 경계) ──────────────── */
function getSolvedAcDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    return now.toLocaleDateString("en-CA"); // "YYYY-MM-DD"
}

/* ──────────────── 상단 기준일 표시 ──────────────── */
function showDateInfo() {
    dateInfo.textContent = `기준일: ${getSolvedAcDate()}`;
}

function normalizeGroupName(value) {
    const name = String(value || "").trim();
    return name ? name : DEFAULT_GROUP_NAME;
}

function normalizeUsers(users) {
    // 문자열 배열이면 새 스키마로 변환
    if (users.length && typeof users[0] === "string") {
        return users.map((h) => ({
            handle: h,
            alias: "",
            group: DEFAULT_GROUP_NAME,
            reverseStreak: 0,
            lastSolvedDate: null,
            lastCheckedDate: null,
            todayCount: 0,
        }));
    }
    // todayCount 필드 보강
    return users.map((u) => {
        const group = normalizeGroupName(u.group);
        return { todayCount: 0, ...u, group };
    });
}

function displayNameOf(u) {
    return u.alias ? `${u.alias} (${u.handle})` : u.handle;
}

/* 정렬 규칙:
    1) reverseStreak===1 (단속대상) 우선, 그 안에서는 알파벳
    2) 나머지: todayCount 내림차순
    3) tie: reverseStreak 오름차순
    4) tie: 이름(별명→아이디) 알파벳
*/
function sortUsers(users) {
    users.sort((a, b) => {
        const aTodayOnly = a.reverseStreak === 1;
        const bTodayOnly = b.reverseStreak === 1;
        if (aTodayOnly !== bTodayOnly) return aTodayOnly ? -1 : 1;

        if (!aTodayOnly && !bTodayOnly) {
            const ac = a.todayCount || 0;
            const bc = b.todayCount || 0;
            if (ac !== bc) return bc - ac;
            if (a.reverseStreak !== b.reverseStreak)
                return a.reverseStreak - b.reverseStreak;
        }

        const aName = a.alias || a.handle;
        const bName = b.alias || b.handle;
        return aName.localeCompare(bName, "en", { sensitivity: "base" });
    });
}

function groupUsers(users) {
    const buckets = new Map();
    users.forEach((u) => {
        u.group = normalizeGroupName(u.group);
        const list = buckets.get(u.group);
        if (list) {
            list.push(u);
        } else {
            buckets.set(u.group, [u]);
        }
    });

    const names = Array.from(buckets.keys()).sort((a, b) => {
        const aDefault = a === DEFAULT_GROUP_NAME;
        const bDefault = b === DEFAULT_GROUP_NAME;
        if (aDefault !== bDefault) return aDefault ? -1 : 1;
        return a.localeCompare(b, "en", { sensitivity: "base" });
    });

    return names.map((name) => ({ name, users: buckets.get(name) || [] }));
}

// HTML 이스케이프 (alias/handle 안전하게 출력)
function esc(s) {
    return String(s).replace(
        /[&<>"']/g,
        (m) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            }[m])
    );
}

/* ──────────────── 정렬 문제를 해결한 updateUI 함수 ──────────────── */
async function updateUI() {
    let users = await getUsers();
    users = normalizeUsers(users);

    // 1. 로딩 상태 표시
    list.innerHTML = "<div style='text-align:center; padding:20px; color:#888;'>데이터 갱신 중...</div>";

    // 2. 모든 사용자의 정보를 병렬로 가져오기
    const updatedUsers = await Promise.all(
        users.map((u) => {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle: u.handle }, (res) => {
                    if (!res || typeof res.count !== "number") {
                        resolve(u); // 에러 시 기존 데이터 유지
                    } else {
                        const today = res.today || getSolvedAcDate();
                        resolve({
                            ...u,
                            todayCount: res.count,
                            lastSolvedDate: res.lastSolvedDate || null,
                            reverseStreak: res.count > 0 ? 0 : Math.max(1, Number(res.reverseStreak) || 1),
                            lastCheckedDate: today,
                        });
                    }
                });
            });
        })
    );

    // 3. 최신 데이터 저장
    await setUsers(updatedUsers);

    // 4. 화면 그리기 (그룹별 정렬)
    list.innerHTML = "";
    groupUsers(updatedUsers).forEach((group) => {
        const header = document.createElement("li");
        header.className = "group-header";
        header.textContent = `그룹: ${group.name}`;
        list.appendChild(header);

        sortUsers(group.users);
        group.users.forEach((u) => {
            const li = document.createElement("li");
            li.className = "user-item";

            // 뱃지 정보 결정
            let rightText, badgeClass;
            if (u.todayCount > 0) {
                rightText = `${u.todayCount}문제`;
                badgeClass = "badge-ok";
            } else if (u.reverseStreak >= 2) {
                rightText = `리버스스트릭 ${u.reverseStreak}일째`;
                badgeClass = "badge-info";
            } else {
                rightText = `단속대상!!!`;
                badgeClass = "badge-danger";
            }

            const span = document.createElement("span");
            span.innerHTML = `${esc(displayNameOf(u))}: <span class="badge ${badgeClass}">${esc(rightText)}</span>`;
            li.appendChild(span);

            // 버튼 그룹 (✎, ×)
            const actions = document.createElement("div");

            const edit = document.createElement("button");
            edit.textContent = "✎";
            edit.className = "edit-btn";
            edit.onclick = async () => {
                const nextAlias = prompt("별명 입력 (비우면 삭제):", u.alias || "");
                if (nextAlias === null) {
                    return;
                }

                const nextGroup = prompt("그룹 입력 (비우면 기본):", u.group || DEFAULT_GROUP_NAME);
                if (nextGroup === null) {
                    return;
                }

                u.alias = nextAlias.trim();
                u.group = normalizeGroupName(nextGroup);
                await setUsers(updatedUsers);
                updateUI();
            };

            const del = document.createElement("button");
            del.textContent = "×";
            del.className = "delete-btn";
            del.onclick = async () => {
                const filtered = updatedUsers.filter(x => x.handle !== u.handle);
                await setUsers(filtered);
                updateUI();
            };

            actions.appendChild(edit);
            actions.appendChild(del);
            li.appendChild(actions);
            list.appendChild(li);
        });
    });
}

/* ──────────────── 사용자 추가 (별명 포함, 없으면 공백) ──────────────── */
btn.onclick = async () => {
    const handle = input.value.trim();
    const alias = aliasInput ? aliasInput.value.trim() : "";
    const group = normalizeGroupName(groupInput ? groupInput.value : "");
    if (!handle) {
        return;
    }

    input.value = "";
    if (aliasInput) {
        aliasInput.value = "";
    }
    if (groupInput) {
        groupInput.value = "";
    }

    let users = await getUsers();
    users = normalizeUsers(users);

    // 중복 등록 방지
    if (users.some((u) => u.handle === handle)) {
        updateUI();
        return;
    }

    // 등록 직후 solved.ac 조회 → 초기값 계산
    chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle }, async (res) => {
        const today = res?.today || getSolvedAcDate();
        const reverseStreak = res.count > 0 ? 0 : Math.max(1, Number(res.reverseStreak) || 1);
        const lastSolvedDate = res.lastSolvedDate || null;

        users.push({
            handle,
            alias,
            group,
            reverseStreak,
            lastSolvedDate,
            lastCheckedDate: today,
            todayCount: res.count || 0,
        });

        // 3. setUsers()를 사용하여 sync와 local 양쪽에 모두 저장합니다.
        await setUsers(users);
        updateUI();
    });
};

async function removeUser(handle) {
    let users = await getUsers();
    const filtered = normalizeUsers(users).filter(
        (u) => u.handle !== handle
    );
    // 삭제 후 양쪽 저장소 동기화 저장
    await setUsers(filtered);
    updateUI();
}

/* ──────────────── 초기 부트스트랩 ──────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    await migrateToSync();
    showDateInfo();
    updateUI();
});
