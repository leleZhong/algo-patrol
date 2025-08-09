const input = document.getElementById("idInput");
const aliasInput = document.getElementById("aliasInput"); // 없으면 null
const btn = document.getElementById("addBtn");
const list = document.getElementById("resultList");
const dateInfo = document.getElementById("dateInfo");

/* ───────────────── 유틸: storage Promise 래퍼 ───────────────── */
function getUsers() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ users: [] }, ({ users }) => resolve(users));
    });
}
function setUsers(users) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ users }, resolve);
    });
}

/* ──────────────── 스키마 마이그레이션: ["jae"] -> [{handle,...}] ──────────────── */
async function migrateUsersIfNeeded() {
    const users = await getUsers();
    if (!users.length) return;
    if (typeof users[0] === "string") {
        const migrated = users.map((h) => ({
            handle: h,
            alias: "",
            reverseStreak: 0,
            lastSolvedDate: null,
            lastCheckedDate: null,
            todayCount: 0,
        }));
        await setUsers(migrated);
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

function normalizeUsers(users) {
    // 문자열 배열이면 새 스키마로 변환
    if (users.length && typeof users[0] === "string") {
        return users.map((h) => ({
            handle: h,
            alias: "",
            reverseStreak: 0,
            lastSolvedDate: null,
            lastCheckedDate: null,
            todayCount: 0,
        }));
    }
    // todayCount 필드 보강
    return users.map((u) => ({ todayCount: 0, ...u }));
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

function updateUI() {
    chrome.storage.local.get({ users: [] }, ({ users }) => {
        users = normalizeUsers(users);
        // 저장소에 반영(한 번만)
        chrome.storage.local.set({ users });

        sortUsers(users);

        list.innerHTML = "";
        users.forEach((u) => {
            const li = document.createElement("li");
            li.className = "user-item";

            // 왼쪽 텍스트
            const span = document.createElement("span");
            span.textContent = `${displayNameOf(u)}: 로딩중...`;
            li.appendChild(span);

            // 오른쪽 버튼 그룹 (✎, ×)
            const actions = document.createElement("div");

            // ✎ 별명 수정/추가/삭제(빈값)
            const edit = document.createElement("button");
            edit.textContent = "✎";
            edit.className = "edit-btn";
            edit.title = "별명 추가/수정";
            edit.onclick = () => {
                chrome.storage.local.get({ users: [] }, ({ users }) => {
                    const arr = normalizeUsers(users);
                    const me = arr.find((x) => x.handle === u.handle);
                    if (!me) return;
                    const next = (
                        prompt("별명 입력(비우면 삭제):", me.alias || "") || ""
                    ).trim();
                    me.alias = next; // 빈값이면 삭제 효과
                    chrome.storage.local.set({ users: arr }, updateUI);
                });
            };
            actions.appendChild(edit);

            // × 삭제
            const del = document.createElement("button");
            del.textContent = "×";
            del.className = "delete-btn";
            del.title = "삭제";
            del.onclick = () => {
                chrome.storage.local.get({ users: [] }, ({ users }) => {
                    const filtered = normalizeUsers(users).filter(
                        (x) => x.handle !== u.handle
                    );
                    chrome.storage.local.set({ users: filtered }, updateUI);
                });
            };
            actions.appendChild(del);

            li.appendChild(actions);
            list.appendChild(li);

            // 비동기: 오늘 데이터 → todayCount / reverseStreak 갱신 후 텍스트 업데이트
            chrome.runtime.sendMessage(
                { type: "FETCH_GRASS", handle: u.handle },
                (res) => {
                    if (!res || typeof res.count !== "number") {
                        span.textContent = `${displayNameOf(u)}: 에러`;
                        return;
                    }

                    const today = res.today || getSolvedAcDate();

                    chrome.storage.local.get({ users: [] }, ({ users }) => {
                        const arr = normalizeUsers(users);
                        const me = arr.find((x) => x.handle === u.handle);
                        if (!me) return;

                        me.todayCount = res.count;
                        me.lastSolvedDate = res.lastSolvedDate || null;
                        me.reverseStreak =
                            res.count > 0
                                ? 0
                                : Math.max(1, Number(res.reverseStreak) || 1);
                        me.lastCheckedDate = today; // 기록용(정렬/표시에 직접 사용하지 않음)

                        chrome.storage.local.set({ users: arr }, () => {
                            const label = displayNameOf(me);

                            // 표시 문자열 + 뱃지 클래스 결정
                            let rightText, badgeClass;
                            if (res.count > 0) {
                                rightText = `${res.count}문제`;
                                badgeClass = "badge-ok"; // 초록
                            } else if (me.reverseStreak >= 2) {
                                rightText = `리버스스트릭 ${me.reverseStreak}일째`;
                                badgeClass = "badge-info"; // 파랑
                            } else {
                                rightText = `단속대상!!!`;
                                badgeClass = "badge-danger"; // 빨강
                            }

                            // 뱃지 적용 (innerHTML 사용, 사용자 입력은 esc()로 안전 처리)
                            span.innerHTML = `${esc(
                                label
                            )}: <span class="badge ${badgeClass}">${esc(
                                rightText
                            )}</span>`;
                        });
                    });
                }
            );
        });
    });
}

/* ──────────────── 사용자 추가 (별명 포함, 없으면 공백) ──────────────── */
btn.onclick = () => {
    const handle = input.value.trim();
    const alias = aliasInput ? aliasInput.value.trim() : "";
    if (!handle) {
        return;
    }

    input.value = "";
    if (aliasInput) {
        aliasInput.value = "";
    }

    chrome.storage.local.get({ users: [] }, ({ users }) => {
        users = normalizeUsers(users);
        if (users.some((u) => u.handle === handle)) {
            updateUI();
            return;
        }

        // 등록 직후 solved.ac 조회 → 초기값 계산
        chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle }, (res) => {
            const today = res?.today || getSolvedAcDate();

            const reverseStreak =
                res.count > 0 ? 0 : Math.max(1, Number(res.reverseStreak) || 1);
            const lastSolvedDate = res.lastSolvedDate || null;

            users.push({
                handle,
                alias,
                reverseStreak,
                lastSolvedDate,
                lastCheckedDate: today,
                todayCount: res.count || 0,
            });

            chrome.storage.local.set({ users }, updateUI);
        });
    });
};

function removeUser(handle) {
    chrome.storage.local.get({ users: [] }, ({ users }) => {
        const filtered = normalizeUsers(users).filter(
            (u) => u.handle !== handle
        );
        chrome.storage.local.set({ users: filtered }, updateUI);
    });
}

/* ──────────────── 초기 부트스트랩 ──────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    await migrateUsersIfNeeded();
    showDateInfo();
    updateUI();
});
