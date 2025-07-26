const input = document.getElementById("idInput");
const btn = document.getElementById("addBtn");
const list = document.getElementById("resultList");
const dateInfo = document.getElementById("dateInfo");

// 로컬 기준 YYYY-MM-DD 생성 함수
function getLocalDate() {
    return new Date().toLocaleDateString("en-CA");  // YYYY-MM-DD
}

// UI 업데이트 전에 기준 날짜 먼저 표시
function showDateInfo() {
    dateInfo.textContent = `기준일: ${getSolvedAcDate()}`;
}

function getSolvedAcDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    return now.toLocaleDateString("en-CA");
}

function updateUI() {
    chrome.storage.local.get({ users: [] }, ({ users }) => {
        // 알파벳순 정렬
        users.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

        // 리스트 초기화
        list.innerHTML = "";

        // placeholder li 생성
        users.forEach(handle => {
            const li = document.createElement("li");
            li.className = "user-item";

            const span = document.createElement("span");
            span.textContent = `${handle}: 로딩중...`;
            li.appendChild(span);

            const del = document.createElement("button");
            del.textContent = "×";
            del.className = "delete-btn";
            del.onclick = () => {
                // 스토리지에서 제거
                chrome.storage.local.get({ users: [] }, ({ users }) => {
                    const filtered = users.filter(u => u !== handle);
                    chrome.storage.local.set({ users: filtered }, updateUI);
                });
            };
            li.appendChild(del);

            list.appendChild(li);

            // 비동기 count 요청 → 같은 span 만 업데이트
            chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle }, res => {
                span.textContent = `${handle}: ${res.count > 0 ? res.count + "문제" : res.count === 0 ? "단속대상!!!" : "에러"}`;
            });
        });
    });
}

btn.onclick = () => {
    const id = input.value.trim();
    if (!id) return;

    input.value = "";

    chrome.storage.local.get({ users: [] }, ({ users }) => {
        if (!users.includes(id)) {
            const newUsers = [...users, id];
            chrome.storage.local.set({ users: newUsers }, updateUI);
        }
    });
};

function removeUser(handle) {
    chrome.storage.local.get({ users: [] }, ({ users }) => {
        const filtered = users.filter(u => u !== handle);
        chrome.storage.local.set({ users: filtered });
    });
}

// 팝업 열릴 때 날짜 표시 + 사용자 리스트 로드
document.addEventListener("DOMContentLoaded", () => {
    showDateInfo();
    updateUI();
});