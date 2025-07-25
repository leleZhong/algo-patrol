const input = document.getElementById("idInput");
const btn = document.getElementById("addBtn");
const list = document.getElementById("resultList");

function updateUI(users) {
    list.innerHTML = "";
    users.forEach(handle => {
        chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle }, res => {
            const li = document.createElement("li");
            if (res.count > 0) {
                li.textContent = `${handle}: ${res.count}문제`;
            } else if (res.count == 0) {
                li.textContent = `${handle}: 단속대상!!!`
            } else {
                li.textContent = `${handle}: 에러`;
            }
            list.appendChild(li);
        });
    });
}

btn.onclick = () => {
    const id = input.value.trim();
    if (!id) return;

    chrome.storage.local.get({ users: [] }, ({ users }) => {
        if (!users.includes(id)) {
            const newUsers = [...users, id];
            chrome.storage.local.set({ users: newUsers }, () => updateUI(newUsers));
        }
    });
};

chrome.storage.local.get({ users: [] }, ({ users }) => updateUI(users));
