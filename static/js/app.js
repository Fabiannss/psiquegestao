const App = {
    currentUser: null,
    usuarios: [],
    pacientes: [],
    currentProntuario: null,

    async init() {
        const hoje = new Date().toISOString().slice(0, 10);
        const mesAtual = hoje.slice(0, 7);
        const finMesEl = document.getElementById("filtro-fin-mes");
        if (finMesEl) finMesEl.value = mesAtual;
        const despMesEl = document.getElementById("filtro-desp-mes");
        if (despMesEl) despMesEl.value = mesAtual;

        await this.loadUsuarios();

        const saved = sessionStorage.getItem("psique_user");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const fresh = this.usuarios.find((u) => u.id === parsed.id);
                if (fresh) {
                    this.entrarComUsuario(fresh);
                    return;
                }
            } catch (_) {}
        }
        this.mostrarTelaLogin();
    },

    mostrarTelaLogin() {
        this.currentUser = null;
        sessionStorage.removeItem("psique_user");
        document.getElementById("app-main-layout").style.display = "none";
        document.getElementById("app-main-layout").classList.remove("layout-visible");
        document.getElementById("login-screen").style.display = "flex";
        document.getElementById("login-erro").style.display = "none";
        this.renderQuickLoginAccounts();
    },

    renderQuickLoginAccounts() {
        const box = document.getElementById("login-quick-accounts");
        if (!box) return;
        const lista = this.usuarios.filter(
            (u) => u.perfil === "admin" || u.perfil === "psicologo"
        );
        box.innerHTML = lista
            .map(
                (u) => `
            <button type="button" class="login-quick-item" onclick="App.preencherLogin('${u.email}')">
                <div>
                    <strong>${u.perfil === "admin" ? "👑 " : "🩺 "}${u.nome}</strong><br>
                    <span style="color:#64748b;">${u.email}</span>
                </div>
                <span class="badge ${u.perfil === "admin" ? "badge-warning" : "badge-info"}">
                    ${u.perfil === "admin" ? "Admin (Tudo)" : "Doutor(a)"}
                </span>
            </button>`
            )
            .join("");
    },

    preencherLogin(email) {
        document.getElementById("login-email").value = email;
        document.getElementById("login-senha").value = "123456";
        document.getElementById("login-erro").style.display = "none";
    },

    async fazerLogin() {
        const email = document.getElementById("login-email").value.trim();
        const senha = document.getElementById("login-senha").value;
        const erroEl = document.getElementById("login-erro");
        erroEl.style.display = "none";

        try {
            const res = await this.api("/api/login", {
                method: "POST",
                body: JSON.stringify({ email, senha }),
            });
            await this.entrarComUsuario(res.usuario);
            this.toast(`Bem-vindo(a), ${res.usuario.nome}!`);
        } catch (e) {
            erroEl.textContent = e.message;
            erroEl.style.display = "block";
        }
    },

    async entrarComUsuario(user) {
        this.currentUser = user;
        sessionStorage.setItem("psique_user", JSON.stringify(user));
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("app-main-layout").style.display = "";
        document.getElementById("app-main-layout").classList.add("layout-visible");

        this.renderUserSelect();
        this.applyRolePermissions();
        await this.loadPacientes();

        if (user.perfil === "admin") {
            this.navigate("dashboard");
        } else {
            // Doutores têm acesso somente a Prontuários e Agendas
            const filtroPsi = document.getElementById("filtro-agenda-psicologo");
            if (filtroPsi) filtroPsi.value = String(user.id);
            this.navigate("agenda");
        }
    },

    logout() {
        this.mostrarTelaLogin();
        this.toast("Sessão encerrada com segurança.");
    },

    applyRolePermissions() {
        const isAdmin = this.currentUser && this.currentUser.perfil === "admin";
        document.querySelectorAll(".nav-btn[data-admin-only='true']").forEach((btn) => {
            btn.style.display = isAdmin ? "flex" : "none";
        });
        // Ocultar opção de gerar cobrança financeira caso não seja admin se desejar, ou manter
        const cobrancaWrap = document.getElementById("ses-cobranca-wrap");
        if (cobrancaWrap) {
            cobrancaWrap.style.display = isAdmin ? "block" : "none";
        }
    },

    async api(path, options = {}) {
        const headers = options.headers || {};
        headers["Content-Type"] = "application/json";
        if (this.currentUser) {
            headers["X-User-Id"] = String(this.currentUser.id);
        }
        const resp = await fetch(path, { ...options, headers });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.erro || "Ocorreu um erro na requisição.");
        }
        return data;
    },

    toast(msg) {
        const el = document.getElementById("toast");
        el.textContent = msg;
        el.style.display = "block";
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            el.style.display = "none";
        }, 3500);
    },

    formatBRL(v) {
        return Number(v || 0).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
        });
    },

    formatDateBR(iso) {
        if (!iso) return "-";
        const parts = iso.slice(0, 10).split("-");
        if (parts.length !== 3) return iso;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    },

    badgeStatusSessao(status) {
        const map = {
            Confirmada: "badge-info",
            Realizada: "badge-success",
            Agendada: "badge-neutral",
            Falta: "badge-danger",
            Cancelada: "badge-danger",
            Remarcada: "badge-warning",
        };
        return `<span class="badge ${map[status] || "badge-neutral"}">${status}</span>`;
    },

    toggleMobileSidebar() {
        const sb = document.getElementById("app-sidebar");
        const bd = document.getElementById("sidebar-backdrop");
        if (sb) sb.classList.toggle("open");
        if (bd) bd.classList.toggle("open");
    },

    closeMobileSidebar() {
        const sb = document.getElementById("app-sidebar");
        const bd = document.getElementById("sidebar-backdrop");
        if (sb) sb.classList.remove("open");
        if (bd) bd.classList.remove("open");
    },

    navigate(view) {
        this.closeMobileSidebar();
        const isAdmin = this.currentUser && this.currentUser.perfil === "admin";
        const adminOnlyViews = ["dashboard", "pacientes", "financeiro", "despesas", "psicologos"];
        if (!isAdmin && adminOnlyViews.includes(view)) {
            this.toast("Acesso restrito ao Administrador. Doutores acessam apenas Agenda e Prontuários.");
            view = "agenda";
        }

        document.querySelectorAll(".view-section").forEach((s) => (s.style.display = "none"));
        document.getElementById(`view-${view}`).style.display = "block";
        document.querySelectorAll(".nav-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.view === view);
        });

        if (view === "dashboard") this.loadDashboard();
        if (view === "agenda") this.loadAgenda();
        if (view === "pacientes") this.loadPacientes();
        if (view === "prontuario") this.initProntuarioView();
        if (view === "financeiro") this.loadFinanceiro();
        if (view === "despesas") this.loadDespesasConsultorio();
        if (view === "psicologos") this.loadUsuarios();
    },

    renderUserSelect() {
        const nameEl = document.getElementById("logged-user-name");
        const emailEl = document.getElementById("logged-user-email");
        const roleEl = document.getElementById("current-user-role");
        if (this.currentUser) {
            if (nameEl) nameEl.textContent = this.currentUser.nome;
            if (emailEl) emailEl.textContent = this.currentUser.email;
            if (roleEl) {
                roleEl.innerHTML =
                    this.currentUser.perfil === "admin"
                        ? `👑 Administrador • Acesso Total`
                        : `🩺 Doutor(a) • Agenda & Prontuários`;
            }
        }
    },

    // ==========================================
    // DASHBOARD
    // ==========================================
    async loadDashboard() {
        try {
            const d = await this.api("/api/dashboard");
            document.getElementById("dash-date-subtitle").textContent =
                `Resumo operacional do dia (${this.formatDateBR(d.hoje)})`;
            document.getElementById("kpi-pacientes").textContent = d.total_pacientes_ativos;
            document.getElementById("kpi-sessoes-hoje").textContent = d.total_sessoes_hoje;
            document.getElementById("kpi-sessoes-mes").textContent =
                `${d.sessoes_realizadas_mes} sessões realizadas neste mês`;
            document.getElementById("kpi-receita-paga").textContent =
                this.formatBRL(d.financeiro_mes.receitas_pagas);
            document.getElementById("kpi-receita-pendente").textContent =
                this.formatBRL(d.financeiro_mes.receitas_pendentes);
            const kpiDespEl = document.getElementById("kpi-despesas-mes");
            if (kpiDespEl) {
                kpiDespEl.textContent = this.formatBRL(
                    d.financeiro_mes.despesas_pagas ?? d.financeiro_mes.despesas_total ?? 0
                );
            }
            const kpiDespSub = document.getElementById("kpi-despesas-sub");
            if (kpiDespSub) {
                const despPend = d.financeiro_mes.despesas_pendentes || 0;
                const saldoLiq = d.financeiro_mes.saldo_liquido ?? 0;
                kpiDespSub.textContent =
                    despPend > 0
                        ? `A pagar: ${this.formatBRL(despPend)} • Saldo: ${this.formatBRL(saldoLiq)}`
                        : `Quitadas no mês • Saldo: ${this.formatBRL(saldoLiq)}`;
            }

            const tbodySes = document.getElementById("dash-sessoes-tbody");
            if (d.sessoes_hoje.length === 0) {
                tbodySes.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b;">Nenhuma sessão agendada para hoje.</td></tr>`;
            } else {
                tbodySes.innerHTML = d.sessoes_hoje
                    .map(
                        (s) => `
                    <tr>
                        <td><strong>${s.hora_inicio}</strong></td>
                        <td>
                            <strong>${s.paciente_nome}</strong><br>
                            <small style="color:#64748b;">${s.paciente_telefone || ""}</small>
                        </td>
                        <td>${s.psicologo_nome}</td>
                        <td>${s.modalidade}</td>
                        <td>${this.badgeStatusSessao(s.status)}</td>
                        <td>
                            <button class="btn btn-sm btn-secondary" onclick="App.mudarStatusSessao(${s.id}, 'Realizada')">✓ Realizada</button>
                            <button class="btn btn-sm btn-secondary" onclick="App.abrirProntuarioDireto(${s.paciente_id})">🔒 Prontuário</button>
                        </td>
                    </tr>`
                    )
                    .join("");
            }

            const tbodyPend = document.getElementById("dash-pendencias-tbody");
            if (d.pendencias_financeiras.length === 0) {
                tbodyPend.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#64748b;">Nenhuma pendência financeira em aberto!</td></tr>`;
            } else {
                tbodyPend.innerHTML = d.pendencias_financeiras
                    .map(
                        (f) => `
                    <tr>
                        <td>${this.formatDateBR(f.data_vencimento)}</td>
                        <td>
                            <strong>${f.paciente_nome || f.descricao}</strong><br>
                            <small style="color:#64748b;">${f.categoria}</small>
                        </td>
                        <td><strong>${this.formatBRL(f.valor)}</strong></td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick="App.quitarLancamento(${f.id})">Dar Baixa</button>
                        </td>
                    </tr>`
                    )
                    .join("");
            }

            const tbodyDesp = document.getElementById("dash-despesas-tbody");
            if (tbodyDesp) {
                const listaDesp = d.despesas_consultorio || [];
                this._despesasConsultorioCache = listaDesp;
                if (listaDesp.length === 0) {
                    tbodyDesp.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">Nenhuma despesa do consultório registrada.</td></tr>`;
                } else {
                    tbodyDesp.innerHTML = listaDesp
                        .map(
                            (f) => `
                        <tr>
                            <td>
                                <strong>${this.formatDateBR(f.data_vencimento)}</strong>
                                ${f.data_pagamento ? `<br><small style="color:#16a34a;">Pago em ${this.formatDateBR(f.data_pagamento)}</small>` : ""}
                            </td>
                            <td><span class="badge badge-danger">🏢 ${f.categoria}</span></td>
                            <td><strong>${f.descricao}</strong></td>
                            <td>${f.forma_pagamento || "-"}</td>
                            <td><strong style="color:#b91c1c;">${this.formatBRL(f.valor)}</strong></td>
                            <td>
                                <span class="badge ${f.status_pagamento === "Pago" ? "badge-success" : "badge-warning"}">${f.status_pagamento}</span>
                            </td>
                            <td>
                                <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                                    ${
                                        f.status_pagamento === "Pendente"
                                            ? `<button class="btn btn-sm btn-primary" onclick="App.quitarLancamento(${f.id})">✓ Dar Baixa</button>`
                                            : ""
                                    }
                                    <button class="btn btn-sm btn-secondary" onclick="App.editarDespesaConsultorio(${f.id})">Editar</button>
                                </div>
                            </td>
                        </tr>`
                        )
                        .join("");
                }
            }
        } catch (e) {
            this.toast(e.message);
        }
    },

    // ==========================================
    // USUÁRIOS / PSICÓLOGOS
    // ==========================================
    async loadUsuarios() {
        this.usuarios = await this.api("/api/usuarios");
        this.renderUserSelect();
        this.renderQuickLoginAccounts();

        const psicologos = this.usuarios.filter((u) => u.perfil === "psicologo");
        const optsPsi = psicologos
            .map((p) => `<option value="${p.id}">${p.nome} (${p.crp || "S/ CRP"})</option>`)
            .join("");

        document.getElementById("filtro-agenda-psicologo").innerHTML =
            `<option value="">Todos os Doutores</option>` + optsPsi;
        document.getElementById("pac-psicologo").innerHTML = optsPsi;
        document.getElementById("ses-psicologo").innerHTML = optsPsi;
        document.getElementById("fin-psicologo").innerHTML =
            `<option value="">-- Clínica Geral --</option>` + optsPsi;

        const tbody = document.getElementById("usuarios-tbody");
        if (tbody) {
            tbody.innerHTML = this.usuarios
                .map(
                    (u) => `
                <tr>
                    <td><strong>${u.nome}</strong></td>
                    <td>
                        <span class="badge ${u.perfil === "admin" ? "badge-warning" : u.perfil === "psicologo" ? "badge-info" : "badge-neutral"}">
                            ${u.perfil === "admin" ? "👑 Administrador(a)" : u.perfil === "psicologo" ? "🩺 Doutor(a)" : "Recepção"}
                        </span>
                    </td>
                    <td>${u.crp || "-"}</td>
                    <td>${u.abordagem || "-"}</td>
                    <td>${u.telefone || ""}<br><small style="color:#64748b;">${u.email}</small></td>
                    <td>${u.perfil === "psicologo" ? this.formatBRL(u.valor_sessao_padrao) : "-"}</td>
                    <td>
                        <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                            <button class="btn btn-sm btn-secondary" onclick="App.editarUsuario(${u.id})">Editar</button>
                            <button class="btn btn-sm btn-danger" onclick="App.excluirUsuario(${u.id})">✕</button>
                        </div>
                    </td>
                </tr>`
                )
                .join("");
        }
    },

    openModalUsuario(usr = null) {
        document.getElementById("form-usuario").reset();
        document.getElementById("usr-id").value = usr ? usr.id : "";
        document.getElementById("modal-usuario-titulo").textContent = usr
            ? `Editar Profissional: ${usr.nome}`
            : "Cadastrar Profissional da Clínica";

        if (usr) {
            document.getElementById("usr-nome").value = usr.nome || "";
            document.getElementById("usr-perfil").value = usr.perfil || "psicologo";
            document.getElementById("usr-crp").value = usr.crp || "";
            document.getElementById("usr-abordagem").value = usr.abordagem || "";
            document.getElementById("usr-email").value = usr.email || "";
            document.getElementById("usr-senha").value = "";
            document.getElementById("usr-telefone").value = usr.telefone || "";
            document.getElementById("usr-valor").value = usr.valor_sessao_padrao || 180;
        }
        document.getElementById("modal-usuario").classList.add("open");
    },

    editarUsuario(id) {
        const usr = this.usuarios.find((u) => u.id === id);
        if (usr) this.openModalUsuario(usr);
    },

    async salvarUsuario() {
        try {
            const id = document.getElementById("usr-id").value;
            const body = {
                id: id ? Number(id) : null,
                nome: document.getElementById("usr-nome").value,
                perfil: document.getElementById("usr-perfil").value,
                crp: document.getElementById("usr-crp").value,
                abordagem: document.getElementById("usr-abordagem").value,
                email: document.getElementById("usr-email").value,
                senha: document.getElementById("usr-senha").value,
                telefone: document.getElementById("usr-telefone").value,
                valor_sessao_padrao: document.getElementById("usr-valor").value,
            };
            const url = id ? `/api/usuarios/${id}` : "/api/usuarios";
            const method = id ? "PUT" : "POST";
            const res = await this.api(url, {
                method,
                body: JSON.stringify(body),
            });
            this.toast(res.mensagem);
            this.closeModal("modal-usuario");
            await this.loadUsuarios();
            if (this.currentUser && String(this.currentUser.id) === String(id)) {
                const updated = this.usuarios.find((u) => String(u.id) === String(id));
                if (updated) {
                    this.currentUser = updated;
                    this.renderUserSelect();
                }
            }
        } catch (e) {
            this.toast(e.message);
        }
    },

    async excluirUsuario(id) {
        if (!confirm("Deseja remover este profissional da equipe ativa?")) return;
        try {
            const res = await this.api(`/api/usuarios/${id}`, { method: "DELETE" });
            this.toast(res.mensagem);
            await this.loadUsuarios();
        } catch (e) {
            this.toast(e.message);
        }
    },

    // ==========================================
    // PACIENTES
    // ==========================================
    async loadPacientes() {
        const busca = document.getElementById("filtro-paciente-busca")?.value || "";
        const status = document.getElementById("filtro-paciente-status")?.value || "";
        const params = new URLSearchParams();
        if (busca) params.set("busca", busca);
        if (status) params.set("status", status);

        this.pacientes = await this.api(`/api/pacientes?${params.toString()}`);

        const optsPac = this.pacientes
            .map((p) => `<option value="${p.id}">${p.nome}</option>`)
            .join("");
        document.getElementById("ses-paciente").innerHTML = optsPac;
        document.getElementById("fin-paciente").innerHTML =
            `<option value="">-- Nenhum --</option>` + optsPac;

        const selPront = document.getElementById("prontuario-paciente-select");
        const valAtual = selPront.value;
        selPront.innerHTML =
            `<option value="">-- Selecione um paciente --</option>` + optsPac;
        if (valAtual) selPront.value = valAtual;

        const tbody = document.getElementById("pacientes-tbody");
        if (this.pacientes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">Nenhum paciente encontrado.</td></tr>`;
            return;
        }
        tbody.innerHTML = this.pacientes
            .map(
                (p) => `
            <tr>
                <td>
                    <strong>${p.nome}</strong><br>
                    <small style="color:#64748b;">CPF: ${p.cpf || "Não informado"}</small>
                </td>
                <td>
                    ${p.telefone || "-"}<br>
                    <small style="color:#64748b;">Emerg.: ${p.contato_emergencia_nome || "-"} ${p.contato_emergencia_telefone || ""}</small>
                </td>
                <td>${p.psicologo_nome || "-"}<br><small style="color:#64748b;">${p.modalidade_padrao}</small></td>
                <td>
                    <strong>${this.formatBRL(p.valor_acordado)}</strong><br>
                    <small style="color:#64748b;">${p.tipo_cobranca}</small>
                </td>
                <td><span class="badge badge-info">${p.total_sessoes_realizadas} sessões</span></td>
                <td>
                    <span class="badge ${p.status === "Ativo" ? "badge-success" : "badge-neutral"}">${p.status}</span>
                </td>
                <td>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                        <button class="btn btn-sm btn-secondary" onclick="App.editarPaciente(${p.id})">Editar</button>
                        <button class="btn btn-sm btn-primary" onclick="App.abrirProntuarioDireto(${p.id})">🔒 Prontuário</button>
                    </div>
                </td>
            </tr>`
            )
            .join("");
    },

    openModalPaciente(pac = null) {
        document.getElementById("form-paciente").reset();
        document.getElementById("pac-id").value = pac ? pac.id : "";
        document.getElementById("modal-paciente-titulo").textContent = pac
            ? `Editar Paciente: ${pac.nome}`
            : "Cadastrar Novo Paciente";

        if (pac) {
            document.getElementById("pac-nome").value = pac.nome || "";
            document.getElementById("pac-cpf").value = pac.cpf || "";
            document.getElementById("pac-nascimento").value = pac.data_nascimento || "";
            document.getElementById("pac-telefone").value = pac.telefone || "";
            document.getElementById("pac-email").value = pac.email || "";
            document.getElementById("pac-endereco").value = pac.endereco || "";
            document.getElementById("pac-emerg-nome").value = pac.contato_emergencia_nome || "";
            document.getElementById("pac-emerg-tel").value = pac.contato_emergencia_telefone || "";
            document.getElementById("pac-psicologo").value = pac.psicologo_id || "";
            document.getElementById("pac-modalidade").value = pac.modalidade_padrao || "Presencial";
            document.getElementById("pac-cobranca").value = pac.tipo_cobranca || "Por Sessão";
            document.getElementById("pac-valor").value = pac.valor_acordado || 180;
            document.getElementById("pac-status").value = pac.status || "Ativo";
            document.getElementById("pac-obs").value = pac.observacoes_administrativas || "";
        }
        document.getElementById("modal-paciente").classList.add("open");
    },

    editarPaciente(id) {
        const pac = this.pacientes.find((p) => p.id === id);
        if (pac) this.openModalPaciente(pac);
    },

    async salvarPaciente() {
        try {
            const id = document.getElementById("pac-id").value;
            const body = {
                nome: document.getElementById("pac-nome").value,
                cpf: document.getElementById("pac-cpf").value,
                data_nascimento: document.getElementById("pac-nascimento").value,
                telefone: document.getElementById("pac-telefone").value,
                email: document.getElementById("pac-email").value,
                endereco: document.getElementById("pac-endereco").value,
                contato_emergencia_nome: document.getElementById("pac-emerg-nome").value,
                contato_emergencia_telefone: document.getElementById("pac-emerg-tel").value,
                psicologo_id: document.getElementById("pac-psicologo").value,
                modalidade_padrao: document.getElementById("pac-modalidade").value,
                tipo_cobranca: document.getElementById("pac-cobranca").value,
                valor_acordado: document.getElementById("pac-valor").value,
                status: document.getElementById("pac-status").value,
                observacoes_administrativas: document.getElementById("pac-obs").value,
            };
            const url = id ? `/api/pacientes/${id}` : "/api/pacientes";
            const method = id ? "PUT" : "POST";
            const res = await this.api(url, { method, body: JSON.stringify(body) });
            this.toast(res.mensagem);
            this.closeModal("modal-paciente");
            await this.loadPacientes();
            await this.loadDashboard();
        } catch (e) {
            this.toast(e.message);
        }
    },

    // ==========================================
    // AGENDA E CONTROLE DE SESSÕES
    // ==========================================
    clearFiltroAgenda() {
        document.getElementById("filtro-agenda-inicio").value = "";
        document.getElementById("filtro-agenda-fim").value = "";
        document.getElementById("filtro-agenda-psicologo").value = "";
        document.getElementById("filtro-agenda-status").value = "";
        this.loadAgenda();
    },

    async loadAgenda() {
        const params = new URLSearchParams();
        const ini = document.getElementById("filtro-agenda-inicio").value;
        const fim = document.getElementById("filtro-agenda-fim").value;
        const psi = document.getElementById("filtro-agenda-psicologo").value;
        const st = document.getElementById("filtro-agenda-status").value;

        if (ini) params.set("data_inicio", ini);
        if (fim) params.set("data_fim", fim);
        if (psi) params.set("psicologo_id", psi);
        if (st) params.set("status", st);

        const sessoes = await this.api(`/api/sessoes?${params.toString()}`);
        const tbody = document.getElementById("agenda-tbody");
        if (sessoes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b;">Nenhuma sessão encontrada para os filtros selecionados.</td></tr>`;
            return;
        }

        tbody.innerHTML = sessoes
            .map(
                (s) => `
            <tr>
                <td>
                    <strong>${this.formatDateBR(s.data_sessao)}</strong> às <strong>${s.hora_inicio}</strong><br>
                    <small style="color:#64748b;">Duração: ${s.duracao_minutos} min</small>
                </td>
                <td>
                    <strong>${s.paciente_nome}</strong><br>
                    <small style="color:#64748b;">${s.paciente_telefone || ""}</small>
                </td>
                <td>${s.psicologo_nome}</td>
                <td>
                    ${s.tipo_sessao}<br>
                    <small style="color:#64748b;">${s.modalidade} ${s.observacoes_agenda ? `• ${s.observacoes_agenda}` : ""}</small>
                </td>
                <td>${this.badgeStatusSessao(s.status)}</td>
                <td style="white-space:nowrap;">
                    <div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:nowrap; white-space:nowrap;">
                        <button class="btn btn-sm btn-secondary" onclick="App.mudarStatusSessao(${s.id}, 'Confirmada')">Confirmar</button>
                        <button class="btn btn-sm btn-primary" onclick="App.mudarStatusSessao(${s.id}, 'Realizada')">✓ Realizada</button>
                        <button class="btn btn-sm btn-secondary" onclick="App.mudarStatusSessao(${s.id}, 'Falta')">Falta</button>
                        <button class="btn btn-sm btn-danger" onclick="App.excluirSessao(${s.id})">✕</button>
                    </div>
                </td>
            </tr>`
            )
            .join("");
    },

    openModalSessao() {
        document.getElementById("form-sessao").reset();
        document.getElementById("ses-id").value = "";
        document.getElementById("ses-data").value = new Date().toISOString().slice(0, 10);
        document.getElementById("ses-hora").value = "14:00";
        document.getElementById("modal-sessao").classList.add("open");
    },

    async salvarSessao() {
        try {
            const body = {
                paciente_id: document.getElementById("ses-paciente").value,
                psicologo_id: document.getElementById("ses-psicologo").value,
                data_sessao: document.getElementById("ses-data").value,
                hora_inicio: document.getElementById("ses-hora").value,
                duracao_minutos: document.getElementById("ses-duracao").value,
                modalidade: document.getElementById("ses-modalidade").value,
                tipo_sessao: document.getElementById("ses-tipo").value,
                status: document.getElementById("ses-status").value,
                observacoes_agenda: document.getElementById("ses-obs").value,
                gerar_cobranca: document.getElementById("ses-gerar-cobranca").checked,
            };
            const res = await this.api("/api/sessoes", {
                method: "POST",
                body: JSON.stringify(body),
            });
            this.toast(res.mensagem);
            this.closeModal("modal-sessao");
            await this.loadAgenda();
            if (this.currentUser && this.currentUser.perfil === "admin") {
                await this.loadDashboard();
            }
        } catch (e) {
            this.toast(e.message);
        }
    },

    async mudarStatusSessao(id, status) {
        try {
            const res = await this.api(`/api/sessoes/${id}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status }),
            });
            this.toast(res.mensagem);
            await this.loadAgenda();
            if (this.currentUser && this.currentUser.perfil === "admin") {
                await this.loadDashboard();
            }
        } catch (e) {
            this.toast(e.message);
        }
    },

    async excluirSessao(id) {
        if (!confirm("Deseja realmente excluir este agendamento?")) return;
        const res = await this.api(`/api/sessoes/${id}`, { method: "DELETE" });
        this.toast(res.mensagem);
        await this.loadAgenda();
        if (this.currentUser && this.currentUser.perfil === "admin") {
            await this.loadDashboard();
        }
    },

    // ==========================================
    // PRONTUÁRIO ELETRÔNICO E ANAMNESE (COM SIGILO)
    // ==========================================
    abrirProntuarioDireto(pacienteId) {
        this.navigate("prontuario");
        const sel = document.getElementById("prontuario-paciente-select");
        sel.value = String(pacienteId);
        this.loadProntuarioPaciente(pacienteId);
    },

    initProntuarioView() {
        const isPsicologo =
            this.currentUser &&
            (this.currentUser.perfil === "psicologo" || this.currentUser.perfil === "admin");

        document.getElementById("prontuario-bloqueado").style.display = isPsicologo
            ? "none"
            : "block";
        document.getElementById("prontuario-conteudo").style.display = isPsicologo
            ? "block"
            : "none";

        if (isPsicologo) {
            const pid = document.getElementById("prontuario-paciente-select").value;
            if (pid) this.loadProntuarioPaciente(pid);
        }
    },

    async loadProntuarioPaciente(pacienteId) {
        if (!pacienteId) {
            document.getElementById("prontuario-detalhes").style.display = "none";
            document.getElementById("prontuario-actions").style.display = "none";
            return;
        }
        try {
            const data = await this.api(`/api/prontuario/${pacienteId}`);
            this.currentProntuario = data;
            document.getElementById("prontuario-detalhes").style.display = "block";
            document.getElementById("prontuario-actions").style.display = "flex";

            // Preencher Anamnese
            const a = data.anamnese || {};
            document.getElementById("anam-queixa").value = a.queixa_principal || "";
            document.getElementById("anam-sintomas").value = a.historico_sintomas || "";
            document.getElementById("anam-familiar").value = a.historico_familiar || "";
            document.getElementById("anam-medico").value = a.historico_medico_psiquiatrico || "";
            document.getElementById("anam-medicamentos").value = a.medicamentos_em_uso || "";
            document.getElementById("anam-rotina").value = a.rotina_sono_alimentacao || "";
            document.getElementById("anam-hipotese").value = a.hipotese_inicial || "";
            document.getElementById("anam-plano").value = a.plano_terapeutico || "";

            // Preencher Evoluções
            document.getElementById("prontuario-contador-evolucoes").textContent =
                `${data.evolucoes.length} evoluções`;
            const tl = document.getElementById("prontuario-timeline");
            if (data.evolucoes.length === 0) {
                tl.innerHTML = `<p style="color:#64748b; text-align:center; padding:1.5rem 0;">Nenhuma evolução de sessão registrada para este paciente ainda.</p>`;
            } else {
                tl.innerHTML = data.evolucoes
                    .map(
                        (e) => `
                    <div class="timeline-item">
                        <div class="timeline-meta">
                            <span>📅 ${this.formatDateBR(e.data_registro)} • ${e.psicologo_nome} (${e.psicologo_crp || ""})</span>
                            <button class="btn btn-sm btn-danger" onclick="App.excluirEvolucao(${e.id})">Excluir</button>
                        </div>
                        ${e.humor_estado ? `<p style="font-size:0.84rem; margin-bottom:0.4rem;"><strong>Estado/Humor:</strong> ${e.humor_estado}</p>` : ""}
                        <p style="margin-bottom:0.5rem; white-space:pre-line;">${e.relato_evolucao}</p>
                        ${e.intervencoes_realizadas ? `<p style="font-size:0.84rem; color:#334155;"><strong>Intervenções:</strong> ${e.intervencoes_realizadas}</p>` : ""}
                        ${e.tarefas_encaminhamentos ? `<p style="font-size:0.84rem; color:#0f766e;"><strong>Encaminhamentos:</strong> ${e.tarefas_encaminhamentos}</p>` : ""}
                    </div>`
                    )
                    .join("");
            }

            // Popular sessões no modal de evolução
            const selSes = document.getElementById("evo-sessao");
            selSes.innerHTML =
                `<option value="">-- Sem vínculo específico --</option>` +
                data.sessoes
                    .map(
                        (s) =>
                            `<option value="${s.id}">${this.formatDateBR(s.data_sessao)} às ${s.hora_inicio} (${s.tipo_sessao} - ${s.status})</option>`
                    )
                    .join("");
        } catch (e) {
            this.toast(e.message);
        }
    },

    async salvarAnamnese() {
        const pid = document.getElementById("prontuario-paciente-select").value;
        if (!pid) return;
        try {
            const body = {
                queixa_principal: document.getElementById("anam-queixa").value,
                historico_sintomas: document.getElementById("anam-sintomas").value,
                historico_familiar: document.getElementById("anam-familiar").value,
                historico_medico_psiquiatrico: document.getElementById("anam-medico").value,
                medicamentos_em_uso: document.getElementById("anam-medicamentos").value,
                rotina_sono_alimentacao: document.getElementById("anam-rotina").value,
                hipotese_inicial: document.getElementById("anam-hipotese").value,
                plano_terapeutico: document.getElementById("anam-plano").value,
            };
            const res = await this.api(`/api/anamnese/${pid}`, {
                method: "POST",
                body: JSON.stringify(body),
            });
            this.toast(res.mensagem);
        } catch (e) {
            this.toast(e.message);
        }
    },

    openModalEvolucao() {
        document.getElementById("form-evolucao").reset();
        document.getElementById("evo-data").value = new Date().toISOString().slice(0, 10);
        document.getElementById("modal-evolucao").classList.add("open");
    },

    async salvarEvolucao() {
        const pid = document.getElementById("prontuario-paciente-select").value;
        if (!pid) return;
        try {
            const body = {
                paciente_id: Number(pid),
                sessao_id: document.getElementById("evo-sessao").value || null,
                data_registro: document.getElementById("evo-data").value,
                humor_estado: document.getElementById("evo-humor").value,
                relato_evolucao: document.getElementById("evo-relato").value,
                intervencoes_realizadas: document.getElementById("evo-intervencoes").value,
                tarefas_encaminhamentos: document.getElementById("evo-tarefas").value,
            };
            const res = await this.api("/api/evolucoes", {
                method: "POST",
                body: JSON.stringify(body),
            });
            this.toast(res.mensagem);
            this.closeModal("modal-evolucao");
            await this.loadProntuarioPaciente(pid);
        } catch (e) {
            this.toast(e.message);
        }
    },

    async excluirEvolucao(id) {
        if (!confirm("Deseja remover este registro de evolução?")) return;
        const pid = document.getElementById("prontuario-paciente-select").value;
        const res = await this.api(`/api/evolucoes/${id}`, { method: "DELETE" });
        this.toast(res.mensagem);
        await this.loadProntuarioPaciente(pid);
    },

    imprimirDeclaracaoComparecimento() {
        if (!this.currentProntuario || !this.currentProntuario.paciente) return;
        const p = this.currentProntuario.paciente;
        const hoje = this.formatDateBR(new Date().toISOString().slice(0, 10));
        const win = window.open("", "_blank", "width=750,height=700");
        win.document.write(`
            <html>
            <head>
                <title>Declaração de Comparecimento - Espaço Isa - ${p.nome}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 45px; color: #1e293b; line-height: 1.8; }
                    .box { border: 2px solid #0f766e; padding: 40px; border-radius: 12px; }
                    .doc-header { text-align: center; margin-bottom: 30px; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
                    .doc-header img { width: 110px; height: 110px; object-fit: contain; border-radius: 12px; }
                    h1 { text-align: center; color: #0f766e; font-size: 20px; margin: 20px 0 30px; text-transform: uppercase; }
                    .assinatura { margin-top: 65px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="box">
                    <div class="doc-header">
                        <img src="/static/img/logo.jpg?v=5" alt="Espaço Isa"><br>
                        <strong style="font-size:18px; color:#0f172a;">Espaço Isa</strong><br>
                        <small style="color:#64748b;">Clínica de Desenvolvimento Infantil</small>
                    </div>
                    <h1>Declaração de Comparecimento</h1>
                    <p>Declaro, para os devidos fins, que o(a) paciente <strong>${p.nome}</strong>, inscrito(a) no CPF sob o nº <strong>${p.cpf || "_______________"}</strong>, compareceu a atendimento psicológico no <strong>Espaço Isa</strong> na data de <strong>${hoje}</strong>.</p>
                    <p style="margin-top:30px;">Por ser expressão da verdade, firmo a presente declaração.</p>
                    <p style="text-align:right; margin-top:40px;">Data de emissão: ${hoje}</p>
                    <div class="assinatura">
                        _______________________________________________________<br>
                        <strong>${p.psicologo_nome || this.currentUser.nome}</strong><br>
                        Psicólogo(a) Clínico(a) • ${p.psicologo_crp || this.currentUser.crp || ""}<br>
                        <small>Espaço Isa</small>
                    </div>
                </div>
                <script>window.print();</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    // ==========================================
    // FINANCEIRO E RECIBOS
    // ==========================================
    async loadFinanceiro() {
        const mes = document.getElementById("filtro-fin-mes").value;
        const tipo = document.getElementById("filtro-fin-tipo").value;
        const status = document.getElementById("filtro-fin-status").value;

        const params = new URLSearchParams();
        if (mes) params.set("mes", mes);
        if (tipo) params.set("tipo", tipo);
        if (status) params.set("status_pagamento", status);

        const data = await this.api(`/api/financeiro?${params.toString()}`);
        document.getElementById("fin-kpi-pagas").textContent = this.formatBRL(
            data.resumo.receitas_pagas
        );
        document.getElementById("fin-kpi-pendentes").textContent = this.formatBRL(
            data.resumo.receitas_pendentes
        );
        const subPend = document.getElementById("fin-kpi-pendentes-sub");
        if (subPend) {
            subPend.textContent = `A receber: ${this.formatBRL(data.resumo.receitas_a_receber || 0)} • A pagar: ${this.formatBRL(data.resumo.despesas_pendentes || 0)}`;
        }
        document.getElementById("fin-kpi-despesas").textContent = this.formatBRL(
            data.resumo.despesas
        );
        document.getElementById("fin-kpi-saldo").textContent = this.formatBRL(
            data.resumo.saldo_liquido
        );

        this._resumoFinanceiroCache = data.resumo;
        this._lancamentosCache = data.lancamentos;
        this.renderDashboardFinanceiro();
        this.renderFluxoBalancete();

        const tbody = document.getElementById("financeiro-tbody");
        if (data.lancamentos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">Nenhum lançamento financeiro encontrado no período.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.lancamentos
            .map(
                (f) => `
            <tr>
                <td>
                    <strong>${this.formatDateBR(f.data_vencimento)}</strong>
                    ${f.data_pagamento ? `<br><small style="color:#16a34a;">Pago em ${this.formatDateBR(f.data_pagamento)}</small>` : ""}
                </td>
                <td>
                    <span class="badge ${f.tipo === "Receita" ? "badge-success" : "badge-danger"}">${f.tipo}</span><br>
                    <small style="color:#64748b;">${f.categoria}</small>
                </td>
                <td>
                    <strong>${f.descricao}</strong>
                    ${f.paciente_nome ? `<br><small style="color:#64748b;">Paciente: ${f.paciente_nome}</small>` : ""}
                </td>
                <td>${f.forma_pagamento}</td>
                <td><strong style="color:${f.tipo === "Receita" ? "#15803d" : "#b91c1c"};">${this.formatBRL(f.valor)}</strong></td>
                <td>
                    <span class="badge ${f.status_pagamento === "Pago" ? "badge-success" : "badge-warning"}">${f.status_pagamento}</span>
                </td>
                <td>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                        ${
                            f.status_pagamento === "Pendente"
                                ? `<button class="btn btn-sm btn-primary" onclick="App.quitarLancamento(${f.id})">✓ Dar Baixa</button>`
                                : ""
                        }
                        ${
                            f.tipo === "Receita" && f.status_pagamento === "Pago"
                                ? `<button class="btn btn-sm btn-secondary" onclick="App.emitirRecibo(${f.id})">🧾 Recibo</button>`
                                : ""
                        }
                        <button class="btn btn-sm btn-secondary" onclick="App.editarLancamento(${f.id})">Editar</button>
                        <button class="btn btn-sm btn-danger" onclick="App.excluirLancamento(${f.id})">✕</button>
                    </div>
                </td>
            </tr>`
            )
            .join("");
    },

    toggleDashboardFinanceiro() {
        const box = document.getElementById("fin-dashboard-box");
        const btn = document.getElementById("btn-toggle-fin-dash");
        if (!box) return;
        const abrir = box.style.display === "none";
        box.style.display = abrir ? "block" : "none";
        if (btn) {
            btn.textContent = abrir
                ? "📊 Ocultar Dashboard Financeiro"
                : "📊 Gerar Dashboard Financeiro";
        }
        if (abrir) {
            this.renderDashboardFinanceiro();
        }
    },

    modoGrafico: "pizza",

    setModoGrafico(modo) {
        this.modoGrafico = modo;
        const btnPizza = document.getElementById("btn-mode-pizza");
        const btnBarras = document.getElementById("btn-mode-barras");
        if (btnPizza) btnPizza.classList.toggle("active", modo === "pizza");
        if (btnBarras) btnBarras.classList.toggle("active", modo === "barras");
        this.renderDashboardFinanceiro();
    },

    _renderChart(containerId, items, totalBase, defaultColor) {
        if (this.modoGrafico === "pizza") {
            this._renderPieChart(containerId, items, totalBase);
        } else {
            this._renderBarChart(containerId, items, totalBase, defaultColor);
        }
    },

    _renderPieChart(containerId, items, totalBase) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const validItems = (items || []).filter((i) => i.valor > 0);
        if (validItems.length === 0 || totalBase <= 0) {
            el.innerHTML = `<p style="font-size:0.86rem; color:#64748b; padding:1rem 0;">Sem valores maiores que zero neste período.</p>`;
            return;
        }

        // SVG Donut/Pie chart (radius = 15.9155 => circumference = 100)
        let cumulativePct = 0;
        const circlesSvg = validItems
            .map((it) => {
                const rawPct = (it.valor / totalBase) * 100;
                const dash = Math.max(0.5, rawPct);
                const gap = 100 - dash;
                const offset = 25 - cumulativePct;
                cumulativePct += rawPct;
                return `<circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="${it.color}" stroke-width="7.5" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}"></circle>`;
            })
            .join("");

        const legendHtml = validItems
            .map((it) => {
                const pct = Math.round((it.valor / totalBase) * 100);
                return `
                <div class="pie-legend-item">
                    <div class="pie-legend-left">
                        <span class="pie-swatch" style="background:${it.color};"></span>
                        <span>${it.label}</span>
                    </div>
                    <div>
                        <strong>${this.formatBRL(it.valor)}</strong>
                        <span style="color:#64748b; font-size:0.78rem; margin-left:4px;">(${pct}%)</span>
                    </div>
                </div>`;
            })
            .join("");

        el.innerHTML = `
            <div class="pie-chart-wrap">
                <div class="pie-svg-box">
                    <svg width="175" height="175" viewBox="0 0 42 42">
                        <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="#f1f5f9" stroke-width="7.5"></circle>
                        ${circlesSvg}
                    </svg>
                    <div style="position:absolute; text-align:center; pointer-events:none;">
                        <span style="display:block; font-size:0.68rem; color:#64748b; text-transform:uppercase; font-weight:700;">Total</span>
                        <strong style="font-size:0.84rem; color:#0f172a;">${this.formatBRL(totalBase)}</strong>
                    </div>
                </div>
                <div class="pie-legend">
                    ${legendHtml}
                </div>
            </div>
        `;
    },

    _renderBarChart(containerId, items, totalBase, defaultColor) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const validItems = (items || []).filter((i) => i.valor > 0);
        if (validItems.length === 0) {
            el.innerHTML = `<p style="font-size:0.86rem; color:#64748b; padding:1rem 0;">Sem dados registrados neste período.</p>`;
            return;
        }
        const base = totalBase > 0 ? totalBase : 1;
        el.innerHTML = validItems
            .map((it) => {
                const pct = Math.min(100, Math.round((it.valor / base) * 100));
                return `
                <div class="chart-bar-row">
                    <div class="chart-bar-label">
                        <span style="display:flex; align-items:center; gap:0.45rem;">
                            <span class="pie-swatch" style="background:${it.color || defaultColor};"></span>
                            ${it.label}
                        </span>
                        <span>${this.formatBRL(it.valor)} (${pct}%)</span>
                    </div>
                    <div class="chart-bar-track">
                        <div class="chart-bar-fill" style="width:${pct}%; background:${it.color || defaultColor};"></div>
                    </div>
                </div>`;
            })
            .join("");
    },

    renderDashboardFinanceiro() {
        const lista = this._lancamentosCache || [];
        const resumo = this._resumoFinanceiroCache || {
            receitas_pagas: 0,
            receitas_pendentes: 0,
            despesas: 0,
            saldo_liquido: 0,
        };

        const mes = document.getElementById("filtro-fin-mes")?.value;
        const lbl = document.getElementById("fin-dash-periodo-label");
        if (lbl) {
            lbl.textContent = mes
                ? `Competência filtrada: ${mes} • ${lista.length} lançamento(s)`
                : `Todo o período • ${lista.length} lançamento(s)`;
        }

        // Mini indicadores
        const recsPagasList = lista.filter(
            (x) => x.tipo === "Receita" && x.status_pagamento === "Pago"
        );
        const ticketMedio =
            recsPagasList.length > 0
                ? resumo.receitas_pagas / recsPagasList.length
                : 0;
        const margem =
            resumo.receitas_pagas > 0
                ? Math.round((resumo.saldo_liquido / resumo.receitas_pagas) * 100)
                : 0;
        const totalMovimentado =
            resumo.receitas_pagas + resumo.despesas + resumo.receitas_pendentes;

        const statsEl = document.getElementById("fin-dash-mini-stats");
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="fin-mini-stat">
                    <span>Margem Líquida</span>
                    <strong style="color:${margem >= 0 ? "#16a34a" : "#dc2626"};">${margem}%</strong>
                </div>
                <div class="fin-mini-stat">
                    <span>Ticket Médio (Receitas)</span>
                    <strong>${this.formatBRL(ticketMedio)}</strong>
                </div>
                <div class="fin-mini-stat">
                    <span>Total Movimentado</span>
                    <strong>${this.formatBRL(totalMovimentado)}</strong>
                </div>
                <div class="fin-mini-stat">
                    <span>Total de Lançamentos</span>
                    <strong>${lista.length} registros</strong>
                </div>
            `;
        }

        // 1. Balanço Geral (Receitas x Despesas x Pendentes)
        this._renderChart(
            "fin-chart-balanco",
            [
                { label: "Receitas Recebidas (Pagas)", valor: resumo.receitas_pagas, color: "#16a34a" },
                { label: "Despesas Pagas (Clínica)", valor: resumo.despesas, color: "#dc2626" },
                { label: "Valores Pendentes (Em Aberto)", valor: resumo.receitas_pendentes, color: "#f59e0b" },
            ],
            totalMovimentado,
            "#0f766e"
        );

        // 2. Despesas da Clínica por Categoria (Aluguel, Energia, Água, Internet, IPTU...)
        const paletteDespesas = [
            "#ef4444",
            "#f97316",
            "#8b5cf6",
            "#0ea5e9",
            "#ec4899",
            "#14b8a6",
            "#64748b",
        ];
        const despMap = {};
        let totalDespGeral = 0;
        lista
            .filter((x) => x.tipo === "Despesa")
            .forEach((x) => {
                despMap[x.categoria] = (despMap[x.categoria] || 0) + Number(x.valor);
                totalDespGeral += Number(x.valor);
            });
        const despItems = Object.entries(despMap)
            .sort((a, b) => b[1] - a[1])
            .map(([label, valor], idx) => ({
                label,
                valor,
                color: paletteDespesas[idx % paletteDespesas.length],
            }));
        this._renderChart("fin-chart-despesas-cat", despItems, totalDespGeral, "#ef4444");
    },

    imprimirDashboardFinanceiro() {
        const printContent = document.getElementById("fin-dash-print-content");
        if (!printContent) return;
        const resumo = this._resumoFinanceiroCache || {};
        const periodoTexto =
            document.getElementById("fin-dash-periodo-label")?.textContent || "";
        const win = window.open("", "_blank", "width=950,height=780");
        win.document.write(`
            <html>
            <head>
                <title>Relatório Financeiro - Espaço Isa</title>
                <link rel="stylesheet" href="/static/css/style.css?v=9">
                <style>
                    body {
                        background: #ffffff;
                        padding: 30px;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .no-print { display: none !important; }
                </style>
            </head>
            <body>
                <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #0f766e; padding-bottom:15px; margin-bottom:22px;">
                    <div style="display:flex; align-items:center; gap:15px;">
                        <img src="/static/img/logo.jpg?v=9" style="width:75px; height:75px; object-fit:contain; border-radius:12px;">
                        <div>
                            <h2 style="color:#0f766e; margin:0;">Espaço Isa — Relatório & Dashboard Financeiro</h2>
                            <small style="color:#64748b;">Clínica de Desenvolvimento Infantil • ${periodoTexto}</small>
                        </div>
                    </div>
                </div>
                <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 1.5rem;">
                    <div class="kpi-card"><div class="kpi-label">Receitas Pagas</div><div class="kpi-value" style="color:#16a34a; font-size:1.3rem;">${this.formatBRL(resumo.receitas_pagas)}</div></div>
                    <div class="kpi-card"><div class="kpi-label">Valores Pendentes</div><div class="kpi-value" style="color:#d97706; font-size:1.3rem;">${this.formatBRL(resumo.receitas_pendentes)}</div></div>
                    <div class="kpi-card"><div class="kpi-label">Despesas Pagas</div><div class="kpi-value" style="color:#dc2626; font-size:1.3rem;">${this.formatBRL(resumo.despesas)}</div></div>
                    <div class="kpi-card"><div class="kpi-label">Saldo Líquido</div><div class="kpi-value" style="font-size:1.3rem;">${this.formatBRL(resumo.saldo_liquido)}</div></div>
                </div>
                ${printContent.innerHTML}
                <script>setTimeout(() => window.print(), 300);</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    // ==========================================
    // RELATÓRIO DE FLUXO DE CAIXA E BALANCETE SIMPLES
    // ==========================================
    toggleFluxoBalancete() {
        const box = document.getElementById("fin-fluxo-balancete-box");
        const btn = document.getElementById("btn-toggle-fluxo");
        if (!box) return;
        const abrir = box.style.display === "none";
        box.style.display = abrir ? "block" : "none";
        if (btn) {
            btn.textContent = abrir
                ? "📑 Ocultar Fluxo & Balancete"
                : "📑 Fluxo de Caixa & Balancete";
        }
        if (abrir) {
            this.renderFluxoBalancete();
        }
    },

    renderFluxoBalancete() {
        const lista = this._lancamentosCache || [];
        const mes = document.getElementById("filtro-fin-mes")?.value;
        const lbl = document.getElementById("fin-fluxo-periodo-label");
        if (lbl) {
            lbl.textContent = mes
                ? `Competência filtrada: ${mes} • ${lista.length} lançamento(s)`
                : `Todo o período • ${lista.length} lançamento(s)`;
        }

        // 1. BALANCETE SIMPLES (Entradas x Saídas agrupadas por Categoria)
        const entradasMap = {};
        const saidasMap = {};
        let totalEntradasPagas = 0;
        let totalEntradasPendentes = 0;
        let totalSaidasPagas = 0;
        let totalSaidasPendentes = 0;

        lista.forEach((f) => {
            const val = Number(f.valor) || 0;
            const pago = f.status_pagamento === "Pago";
            const cat = f.categoria || "Sem Categoria";

            if (f.tipo === "Receita") {
                if (!entradasMap[cat]) entradasMap[cat] = { pago: 0, pendente: 0, total: 0 };
                if (pago) {
                    entradasMap[cat].pago += val;
                    totalEntradasPagas += val;
                } else {
                    entradasMap[cat].pendente += val;
                    totalEntradasPendentes += val;
                }
                entradasMap[cat].total += val;
            } else {
                if (!saidasMap[cat]) saidasMap[cat] = { pago: 0, pendente: 0, total: 0 };
                if (pago) {
                    saidasMap[cat].pago += val;
                    totalSaidasPagas += val;
                } else {
                    saidasMap[cat].pendente += val;
                    totalSaidasPendentes += val;
                }
                saidasMap[cat].total += val;
            }
        });

        const renderTabelaBalancete = (mapa, totalPago, totalPend, corTexto, msgVazia) => {
            const entries = Object.entries(mapa).sort((a, b) => b[1].total - a[1].total);
            if (entries.length === 0) {
                return `<p style="font-size:0.86rem; color:#64748b; padding:0.75rem 0;">${msgVazia}</p>`;
            }
            const linhas = entries
                .map(
                    ([cat, v]) => `
                <tr>
                    <td style="padding:0.45rem 0.5rem;"><strong>${cat}</strong></td>
                    <td style="padding:0.45rem 0.5rem; text-align:right; color:${corTexto}; font-weight:600;">${this.formatBRL(v.pago)}</td>
                    <td style="padding:0.45rem 0.5rem; text-align:right; color:#d97706;">${this.formatBRL(v.pendente)}</td>
                    <td style="padding:0.45rem 0.5rem; text-align:right; font-weight:700;">${this.formatBRL(v.total)}</td>
                </tr>`
                )
                .join("");

            return `
                <table style="width:100%; font-size:0.84rem;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                            <th style="padding:0.4rem 0.5rem; text-align:left;">Categoria</th>
                            <th style="padding:0.4rem 0.5rem; text-align:right;">Realizado (Pago)</th>
                            <th style="padding:0.4rem 0.5rem; text-align:right;">Pendente</th>
                            <th style="padding:0.4rem 0.5rem; text-align:right;">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #cbd5e1; background:#f8fafc; font-weight:700;">
                            <td style="padding:0.55rem 0.5rem;">TOTAL</td>
                            <td style="padding:0.55rem 0.5rem; text-align:right; color:${corTexto};">${this.formatBRL(totalPago)}</td>
                            <td style="padding:0.55rem 0.5rem; text-align:right; color:#d97706;">${this.formatBRL(totalPend)}</td>
                            <td style="padding:0.55rem 0.5rem; text-align:right;">${this.formatBRL(totalPago + totalPend)}</td>
                        </tr>
                    </tfoot>
                </table>
            `;
        };

        const elEntradas = document.getElementById("balancete-entradas-body");
        if (elEntradas) {
            elEntradas.innerHTML = renderTabelaBalancete(
                entradasMap,
                totalEntradasPagas,
                totalEntradasPendentes,
                "#15803d",
                "Nenhuma entrada registrada neste período."
            );
        }

        const elSaidas = document.getElementById("balancete-saidas-body");
        if (elSaidas) {
            elSaidas.innerHTML = renderTabelaBalancete(
                saidasMap,
                totalSaidasPagas,
                totalSaidasPendentes,
                "#b91c1c",
                "Nenhuma saída/despesa registrada neste período."
            );
        }

        const saldoCaixaRealizado = totalEntradasPagas - totalSaidasPagas;
        const saldoProjetadoTotal =
            totalEntradasPagas +
            totalEntradasPendentes -
            (totalSaidasPagas + totalSaidasPendentes);

        const elResumo = document.getElementById("balancete-resumo-final");
        if (elResumo) {
            elResumo.innerHTML = `
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:0.85rem; background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:1rem;">
                    <div>
                        <span style="display:block; font-size:0.75rem; color:#64748b; text-transform:uppercase; font-weight:700;">Total Entradas Realizadas (+)</span>
                        <strong style="font-size:1.15rem; color:#15803d;">+ ${this.formatBRL(totalEntradasPagas)}</strong>
                    </div>
                    <div>
                        <span style="display:block; font-size:0.75rem; color:#64748b; text-transform:uppercase; font-weight:700;">Total Saídas Pagas (-)</span>
                        <strong style="font-size:1.15rem; color:#b91c1c;">- ${this.formatBRL(totalSaidasPagas)}</strong>
                    </div>
                    <div>
                        <span style="display:block; font-size:0.75rem; color:#64748b; text-transform:uppercase; font-weight:700;">Resultado / Saldo em Caixa (=)</span>
                        <strong style="font-size:1.25rem; color:${saldoCaixaRealizado >= 0 ? "#0f766e" : "#dc2626"};">${this.formatBRL(saldoCaixaRealizado)}</strong>
                    </div>
                    <div>
                        <span style="display:block; font-size:0.75rem; color:#64748b; text-transform:uppercase; font-weight:700;">Saldo Projetado (c/ Pendentes)</span>
                        <strong style="font-size:1.1rem; color:#334155;">${this.formatBRL(saldoProjetadoTotal)}</strong>
                    </div>
                </div>
            `;
        }

        // 2. EXTRATO DE FLUXO DE CAIXA CRONOLÓGICO (Entradas e Saídas dia a dia)
        const tbodyFluxo = document.getElementById("fluxo-caixa-tbody");
        const tfootFluxo = document.getElementById("fluxo-caixa-tfoot");
        if (!tbodyFluxo || !tfootFluxo) return;

        if (lista.length === 0) {
            tbodyFluxo.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">Nenhuma movimentação financeira no período selecionado.</td></tr>`;
            tfootFluxo.innerHTML = "";
            return;
        }

        // Ordenar cronologicamente (data mais antiga para a mais recente) para cálculo do saldo acumulado
        const cronologico = [...lista].sort((a, b) => {
            const da = a.data_pagamento || a.data_vencimento || "";
            const db = b.data_pagamento || b.data_vencimento || "";
            if (da !== db) return da.localeCompare(db);
            return (a.id || 0) - (b.id || 0);
        });

        let saldoAcumulado = 0;
        tbodyFluxo.innerHTML = cronologico
            .map((f) => {
                const val = Number(f.valor) || 0;
                const isReceita = f.tipo === "Receita";
                const isPago = f.status_pagamento === "Pago";

                if (isPago) {
                    saldoAcumulado += isReceita ? val : -val;
                }

                const dataRef = f.data_pagamento || f.data_vencimento;
                return `
                <tr style="${!isPago ? "opacity:0.78; background:#fffbeb;" : ""}">
                    <td>
                        <strong>${this.formatDateBR(dataRef)}</strong>
                        <br><small style="color:#64748b;">${f.forma_pagamento || "-"}</small>
                    </td>
                    <td>
                        <strong>${f.descricao}</strong>
                        ${f.paciente_nome ? `<br><small style="color:#64748b;">Paciente: ${f.paciente_nome}</small>` : `<br><small style="color:#4338ca;">🏢 Consultório Espaço Isa</small>`}
                    </td>
                    <td><span class="badge badge-neutral">${f.categoria}</span></td>
                    <td>
                        <span class="badge ${isPago ? "badge-success" : "badge-warning"}">${f.status_pagamento}</span>
                    </td>
                    <td style="color:#15803d; font-weight:700;">
                        ${isReceita ? `+ ${this.formatBRL(val)}` : "—"}
                    </td>
                    <td style="color:#b91c1c; font-weight:700;">
                        ${!isReceita ? `- ${this.formatBRL(val)}` : "—"}
                    </td>
                    <td style="font-weight:700; color:${saldoAcumulado >= 0 ? "#0f172a" : "#dc2626"};">
                        ${isPago ? this.formatBRL(saldoAcumulado) : `<small style="color:#d97706;">(Aguardando baixa)</small>`}
                    </td>
                </tr>`;
            })
            .join("");

        tfootFluxo.innerHTML = `
            <tr style="background:#f1f5f9; border-top:2px solid #94a3b8; font-weight:700;">
                <td colspan="4" style="text-align:right; padding:0.75rem 1rem;">TOTAIS REALIZADOS NO CAIXA (QUITADOS):</td>
                <td style="color:#15803d; padding:0.75rem 1rem;">+ ${this.formatBRL(totalEntradasPagas)}</td>
                <td style="color:#b91c1c; padding:0.75rem 1rem;">- ${this.formatBRL(totalSaidasPagas)}</td>
                <td style="color:${saldoCaixaRealizado >= 0 ? "#0f766e" : "#dc2626"}; font-size:1rem; padding:0.75rem 1rem;">= ${this.formatBRL(saldoCaixaRealizado)}</td>
            </tr>
        `;
    },

    imprimirFluxoBalancete() {
        const printContent = document.getElementById("fin-fluxo-print-content");
        if (!printContent) return;
        const periodoTexto =
            document.getElementById("fin-fluxo-periodo-label")?.textContent || "";
        const win = window.open("", "_blank", "width=1000,height=820");
        win.document.write(`
            <html>
            <head>
                <title>Fluxo de Caixa e Balancete - Espaço Isa</title>
                <link rel="stylesheet" href="/static/css/style.css?v=9">
                <style>
                    body {
                        background: #ffffff;
                        padding: 28px;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .no-print { display: none !important; }
                </style>
            </head>
            <body>
                <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #3730a3; padding-bottom:14px; margin-bottom:20px;">
                    <div style="display:flex; align-items:center; gap:15px;">
                        <img src="/static/img/logo.jpg?v=9" style="width:70px; height:70px; object-fit:contain; border-radius:12px;">
                        <div>
                            <h2 style="color:#3730a3; margin:0;">Espaço Isa — Relatório de Fluxo de Caixa & Balancete Simples</h2>
                            <small style="color:#64748b;">Clínica de Desenvolvimento Infantil • ${periodoTexto}</small>
                        </div>
                    </div>
                </div>
                ${printContent.innerHTML}
                <script>setTimeout(() => window.print(), 300);</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    // ==========================================
    // CONTROLE DE DESPESAS EXCLUSIVO DO CONSULTÓRIO
    // ==========================================
    async loadDespesasConsultorio() {
        const mes = document.getElementById("filtro-desp-mes")?.value || "";
        const cat = document.getElementById("filtro-desp-categoria")?.value || "";
        const status = document.getElementById("filtro-desp-status")?.value || "";

        const params = new URLSearchParams();
        params.set("tipo", "Despesa");
        if (mes) params.set("mes", mes);
        if (cat) params.set("categoria", cat);
        if (status) params.set("status_pagamento", status);

        const data = await this.api(`/api/financeiro?${params.toString()}`);
        const despesas = data.lancamentos || [];
        this._despesasConsultorioCache = despesas;

        const pagas = despesas
            .filter((x) => x.status_pagamento === "Pago")
            .reduce((acc, x) => acc + Number(x.valor), 0);
        const pendentes = despesas
            .filter((x) => x.status_pagamento === "Pendente")
            .reduce((acc, x) => acc + Number(x.valor), 0);
        const total = pagas + pendentes;

        // Maior categoria de custo
        const catMap = {};
        despesas.forEach((x) => {
            catMap[x.categoria] = (catMap[x.categoria] || 0) + Number(x.valor);
        });
        const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

        document.getElementById("desp-kpi-pagas").textContent = this.formatBRL(pagas);
        document.getElementById("desp-kpi-pendentes").textContent = this.formatBRL(pendentes);
        document.getElementById("desp-kpi-total").textContent = this.formatBRL(total);
        document.getElementById("desp-kpi-maior-cat").textContent =
            sortedCats.length > 0 ? sortedCats[0][0] : "Nenhuma";
        document.getElementById("desp-kpi-maior-valor").textContent =
            sortedCats.length > 0
                ? `${this.formatBRL(sortedCats[0][1])} no período`
                : "Sem despesas no período";

        const tbody = document.getElementById("despesas-consultorio-tbody");
        if (!tbody) return;
        if (despesas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">Nenhuma despesa do consultório registrada neste período.</td></tr>`;
            return;
        }

        tbody.innerHTML = despesas
            .map(
                (f) => `
            <tr>
                <td>
                    <strong>${this.formatDateBR(f.data_vencimento)}</strong>
                    ${f.data_pagamento ? `<br><small style="color:#16a34a;">Pago em ${this.formatDateBR(f.data_pagamento)}</small>` : ""}
                </td>
                <td>
                    <span class="badge badge-danger">🏢 ${f.categoria}</span>
                </td>
                <td>
                    <strong>${f.descricao}</strong>
                    <br><small style="color:#64748b;">Despesa Exclusiva do Consultório (Espaço Isa)</small>
                </td>
                <td>${f.forma_pagamento}</td>
                <td><strong style="color:#b91c1c;">${this.formatBRL(f.valor)}</strong></td>
                <td>
                    <span class="badge ${f.status_pagamento === "Pago" ? "badge-success" : "badge-warning"}">${f.status_pagamento}</span>
                </td>
                <td>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                        ${
                            f.status_pagamento === "Pendente"
                                ? `<button class="btn btn-sm btn-primary" onclick="App.quitarLancamento(${f.id})">✓ Dar Baixa</button>`
                                : ""
                        }
                        <button class="btn btn-sm btn-secondary" onclick="App.editarDespesaConsultorio(${f.id})">Editar</button>
                        <button class="btn btn-sm btn-danger" onclick="App.excluirLancamento(${f.id})">✕</button>
                    </div>
                </td>
            </tr>`
            )
            .join("");
    },

    _opcoesCatReceita: `
        <optgroup label="Receitas de Atendimento">
            <option value="Sessão">Sessão Individual</option>
            <option value="Pacote Mensal">Pacote Mensal</option>
            <option value="Avaliação / Laudo">Avaliação / Laudo</option>
            <option value="Outros">Outros</option>
        </optgroup>
    `,

    _opcoesCatDespesa: `
        <optgroup label="Controle de Despesas do Consultório (Espaço Isa)">
            <option value="Despesas">Despesas</option>
            <option value="Aluguel da Clínica">Aluguel da Clínica</option>
            <option value="Energia">Energia Elétrica</option>
            <option value="Água">Água</option>
            <option value="Internet">Internet / Telefone</option>
            <option value="IPTU">IPTU</option>
            <option value="Material / Brinquedos Terapêuticos">Material / Brinquedos Terapêuticos</option>
            <option value="Limpeza / Copa">Limpeza / Higiene / Copa</option>
            <option value="Manutenção">Manutenção / Equipamentos</option>
            <option value="Conselho CRP / Impostos">CRP / Contabilidade / Impostos</option>
            <option value="Outros">Outras Despesas do Consultório</option>
        </optgroup>
    `,

    openModalDespesaConsultorio() {
        document.getElementById("form-financeiro").reset();
        document.getElementById("fin-id").value = "";
        document.getElementById("modal-financeiro-titulo").textContent =
            "🏢 Nova Despesa do Consultório (Espaço Isa)";
        document.getElementById("fin-tipo").value = "Despesa";
        this.aoMudarTipoFinanceiro("Despesa", "Despesas");
        document.getElementById("fin-vencimento").value = new Date()
            .toISOString()
            .slice(0, 10);
        document.getElementById("fin-status").value = "Pendente";
        document.getElementById("modal-financeiro").classList.add("open");
    },

    editarDespesaConsultorio(id) {
        const item = (this._despesasConsultorioCache || []).find((x) => x.id === id);
        if (item) this.openModalFinanceiro(item);
    },

    aoMudarTipoFinanceiro(tipo, categoriaPreferida = null) {
        const rowPac = document.getElementById("fin-vinculo-paciente-row");
        if (rowPac) {
            rowPac.style.display = tipo === "Despesa" ? "none" : "grid";
        }
        const selectCat = document.getElementById("fin-categoria");
        const valorAnterior = categoriaPreferida || (selectCat ? selectCat.value : "");

        if (tipo === "Despesa") {
            document.getElementById("fin-paciente").value = "";
            document.getElementById("fin-psicologo").value = "";
            if (selectCat) {
                selectCat.innerHTML = this._opcoesCatDespesa;
                const opcoesValidas = Array.from(selectCat.options).map((o) => o.value);
                selectCat.value = opcoesValidas.includes(valorAnterior)
                    ? valorAnterior
                    : "Despesas";
            }
        } else {
            if (selectCat) {
                selectCat.innerHTML = this._opcoesCatReceita;
                const opcoesValidas = Array.from(selectCat.options).map((o) => o.value);
                selectCat.value = opcoesValidas.includes(valorAnterior)
                    ? valorAnterior
                    : "Sessão";
            }
        }
    },

    aoMudarCategoriaFinanceiro(cat) {
        // As opções de categoria agora já são filtradas diretamente pelo Tipo (Receita x Despesa)
    },

    openModalFinanceiro(item = null) {
        document.getElementById("form-financeiro").reset();
        document.getElementById("fin-id").value = item ? item.id : "";
        document.getElementById("modal-financeiro-titulo").textContent = item
            ? `Editar Lançamento: ${item.descricao}`
            : "Novo Lançamento Financeiro";

        if (item) {
            const tipoItem = item.tipo || "Receita";
            document.getElementById("fin-tipo").value = tipoItem;
            this.aoMudarTipoFinanceiro(tipoItem, item.categoria);
            document.getElementById("fin-descricao").value = item.descricao || "";
            document.getElementById("fin-paciente").value = item.paciente_id || "";
            document.getElementById("fin-psicologo").value = item.psicologo_id || "";
            document.getElementById("fin-valor").value = item.valor || "";
            document.getElementById("fin-vencimento").value = item.data_vencimento || "";
            document.getElementById("fin-status").value = item.status_pagamento || "Pendente";
            document.getElementById("fin-forma").value = item.forma_pagamento || "PIX";
        } else {
            document.getElementById("fin-tipo").value = "Receita";
            this.aoMudarTipoFinanceiro("Receita", "Sessão");
            document.getElementById("fin-vencimento").value = new Date()
                .toISOString()
                .slice(0, 10);
        }
        document.getElementById("modal-financeiro").classList.add("open");
    },

    editarLancamento(id) {
        const item = (this._lancamentosCache || []).find((x) => x.id === id);
        if (item) this.openModalFinanceiro(item);
    },

    async salvarFinanceiro() {
        try {
            const id = document.getElementById("fin-id").value;
            const tipo = document.getElementById("fin-tipo").value;
            const body = {
                tipo,
                categoria: document.getElementById("fin-categoria").value,
                descricao: document.getElementById("fin-descricao").value,
                paciente_id: tipo === "Despesa" ? null : document.getElementById("fin-paciente").value,
                psicologo_id: tipo === "Despesa" ? null : document.getElementById("fin-psicologo").value,
                valor: document.getElementById("fin-valor").value,
                data_vencimento: document.getElementById("fin-vencimento").value,
                status_pagamento: document.getElementById("fin-status").value,
                forma_pagamento: document.getElementById("fin-forma").value,
            };
            const url = id ? `/api/financeiro/${id}` : "/api/financeiro";
            const method = id ? "PUT" : "POST";
            const res = await this.api(url, {
                method,
                body: JSON.stringify(body),
            });
            this.toast(res.mensagem);
            this.closeModal("modal-financeiro");
            await this.loadFinanceiro();
            await this.loadDespesasConsultorio();
            await this.loadDashboard();
        } catch (e) {
            this.toast(e.message);
        }
    },

    async quitarLancamento(id) {
        const res = await this.api(`/api/financeiro/${id}/pagar`, {
            method: "PATCH",
            body: JSON.stringify({ forma_pagamento: "PIX" }),
        });
        this.toast(res.mensagem);
        await this.loadFinanceiro();
        await this.loadDespesasConsultorio();
        await this.loadDashboard();
    },

    async excluirLancamento(id) {
        if (!confirm("Deseja excluir este lançamento financeiro?")) return;
        const res = await this.api(`/api/financeiro/${id}`, { method: "DELETE" });
        this.toast(res.mensagem);
        await this.loadFinanceiro();
        await this.loadDespesasConsultorio();
        await this.loadDashboard();
    },

    emitirRecibo(id) {
        const item = (this._lancamentosCache || []).find((x) => x.id === id);
        if (!item) return;

        const win = window.open("", "_blank", "width=750,height=680");
        win.document.write(`
            <html>
            <head>
                <title>Recibo de Pagamento #${item.id} - Espaço Isa</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 40px; color: #0f172a; line-height: 1.7; }
                    .recibo { border: 2px solid #0f766e; padding: 35px; border-radius: 12px; }
                    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 25px; }
                    .brand-recibo { display: flex; align-items: center; gap: 14px; }
                    .brand-recibo img { width: 80px; height: 80px; object-fit: contain; border-radius: 12px; }
                    .valor-box { background: #f0fdfa; border: 1px solid #14b8a6; padding: 8px 16px; border-radius: 8px; font-weight: bold; font-size: 20px; color: #0f766e; }
                    .assinatura { margin-top: 60px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="recibo">
                    <div class="header">
                        <div class="brand-recibo">
                            <img src="/static/img/logo.jpg?v=5" alt="Espaço Isa">
                            <div>
                                <h2 style="margin:0; color:#0f766e;">ESPAÇO ISA • RECIBO Nº ${String(item.id).padStart(4, "0")}</h2>
                                <small>Clínica de Desenvolvimento Infantil</small>
                            </div>
                        </div>
                        <div class="valor-box">${this.formatBRL(item.valor)}</div>
                    </div>
                    <p>Recebemos de <strong>${item.paciente_nome || "___________________________"}</strong>, CPF nº <strong>${item.paciente_cpf || "___.___.___-__"}</strong>, a importância de <strong>${this.formatBRL(item.valor)}</strong>, referente a <strong>${item.descricao}</strong>.</p>
                    <p><strong>Forma de Pagamento:</strong> ${item.forma_pagamento} &nbsp;|&nbsp; <strong>Data da Quitação:</strong> ${this.formatDateBR(item.data_pagamento || item.data_vencimento)}</p>
                    <div class="assinatura">
                        _______________________________________________________<br>
                        <strong>${item.psicologo_nome || "Espaço Isa"}</strong><br>
                        ${item.psicologo_crp || "Atendimento Psicológico"} • Espaço Isa
                    </div>
                </div>
                <script>window.print();</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    closeModal(id) {
        document.getElementById(id).classList.remove("open");
    },
};

window.addEventListener("DOMContentLoaded", () => App.init());
