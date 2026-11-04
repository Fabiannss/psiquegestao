import json
import mimetypes
import os
import re
from datetime import datetime
from urllib.parse import parse_qs, urlparse
from wsgiref.simple_server import make_server

from database import get_connection, hash_password, init_db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class APIError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


def get_current_user(headers: dict):
    user_id = headers.get("X-User-Id") or headers.get("x-user-id")
    if not user_id:
        return None
    conn = get_connection()
    user = conn.execute(
        "SELECT id, nome, email, perfil, crp, abordagem, telefone, valor_sessao_padrao FROM usuarios WHERE id = ? AND ativo = 1",
        (user_id,),
    ).fetchone()
    conn.close()
    return row_to_dict(user)


def ensure_admin_exists(conn):
    adm = conn.execute("SELECT id FROM usuarios WHERE perfil = 'admin' AND ativo = 1").fetchone()
    if not adm:
        conn.execute(
            """
            INSERT OR IGNORE INTO usuarios (nome, email, senha_hash, perfil, crp, abordagem, telefone, valor_sessao_padrao, ativo)
            VALUES (?, ?, ?, 'admin', NULL, 'Administração Geral', '(11) 99999-0000', 0.0, 1)
            """,
            ("Administrador da Clínica", "admin", hash_password("admin123")),
        )
        conn.commit()


def require_psicologo(headers: dict):
    user = get_current_user(headers)
    if not user:
        raise APIError("Usuário não autenticado. Faça login novamente.", 401)
    if user["perfil"] not in ("psicologo", "admin"):
        raise APIError(
            "Acesso restrito: O Prontuário Eletrônico e a Anamnese só podem ser acessados por Doutores ou pelo Administrador.",
            403,
        )
    return user


def require_admin(headers: dict):
    user = get_current_user(headers)
    if not user:
        raise APIError("Usuário não autenticado. Faça login novamente.", 401)
    if user["perfil"] != "admin":
        raise APIError(
            "Acesso restrito ao Administrador: O perfil de Doutor(a) possui acesso exclusivo aos módulos de Agenda e Prontuário.",
            403,
        )
    return user


# ==========================================
# HANDLERS DE NEGÓCIO DA CLÍNICA
# ==========================================

def handle_login(body: dict):
    conn = get_connection()
    ensure_admin_exists(conn)
    if "usuario_id" in body and not body.get("email"):
        user = conn.execute(
            "SELECT id, nome, email, perfil, crp, abordagem, telefone, valor_sessao_padrao FROM usuarios WHERE id = ? AND ativo = 1",
            (body["usuario_id"],),
        ).fetchone()
        conn.close()
        if not user:
            raise APIError("Usuário não encontrado.", 404)
        return {"usuario": row_to_dict(user)}

    email = (body.get("email") or "").strip().lower()
    senha = body.get("senha") or ""
    user = conn.execute(
        "SELECT id, nome, email, perfil, crp, abordagem, telefone, valor_sessao_padrao FROM usuarios WHERE lower(email) = ? AND senha_hash = ? AND ativo = 1",
        (email, hash_password(senha)),
    ).fetchone()
    conn.close()
    if not user:
        raise APIError("Usuário ou senha incorretos.", 401)
    return {"usuario": row_to_dict(user)}


def handle_dashboard(query: dict, headers: dict):
    hoje = datetime.now().strftime("%Y-%m-%d")
    mes_atual = datetime.now().strftime("%Y-%m")
    psicologo_id = query.get("psicologo_id")

    conn = get_connection()

    # Total de pacientes ativos
    if psicologo_id:
        total_pacientes = conn.execute(
            "SELECT COUNT(*) as c FROM pacientes WHERE status = 'Ativo' AND psicologo_id = ?",
            (psicologo_id,),
        ).fetchone()["c"]
    else:
        total_pacientes = conn.execute(
            "SELECT COUNT(*) as c FROM pacientes WHERE status = 'Ativo'"
        ).fetchone()["c"]

    # Sessões de hoje
    sql_sessoes_hoje = """
        SELECT s.*, p.nome as paciente_nome, p.telefone as paciente_telefone,
               u.nome as psicologo_nome, u.crp as psicologo_crp
        FROM sessoes s
        JOIN pacientes p ON p.id = s.paciente_id
        JOIN usuarios u ON u.id = s.psicologo_id
        WHERE s.data_sessao = ?
    """
    params_hoje = [hoje]
    if psicologo_id:
        sql_sessoes_hoje += " AND s.psicologo_id = ?"
        params_hoje.append(psicologo_id)
    sql_sessoes_hoje += " ORDER BY s.hora_inicio ASC"
    sessoes_hoje = rows_to_list(conn.execute(sql_sessoes_hoje, params_hoje).fetchall())

    # Resumo financeiro do mês
    sql_fin = """
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status_pagamento = 'Pago' THEN valor ELSE 0 END), 0) as receitas_pagas,
            COALESCE(SUM(CASE WHEN status_pagamento = 'Pendente' THEN valor ELSE 0 END), 0) as receitas_pendentes,
            COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status_pagamento = 'Pago' THEN valor ELSE 0 END), 0) as despesas_pagas,
            COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status_pagamento = 'Pendente' THEN valor ELSE 0 END), 0) as despesas_pendentes,
            COALESCE(SUM(CASE WHEN tipo = 'Despesa' THEN valor ELSE 0 END), 0) as despesas_total
        FROM financeiro
        WHERE substr(data_vencimento, 1, 7) = ?
    """
    params_fin = [mes_atual]
    if psicologo_id:
        sql_fin += " AND (psicologo_id = ? OR tipo = 'Despesa')"
        params_fin.append(psicologo_id)
    fin_resumo = row_to_dict(conn.execute(sql_fin, params_fin).fetchone())
    fin_resumo["saldo_liquido"] = fin_resumo["receitas_pagas"] - fin_resumo["despesas_pagas"]

    # Total de sessões realizadas no mês
    sql_realizadas = "SELECT COUNT(*) as c FROM sessoes WHERE substr(data_sessao, 1, 7) = ? AND status = 'Realizada'"
    params_real = [mes_atual]
    if psicologo_id:
        sql_realizadas += " AND psicologo_id = ?"
        params_real.append(psicologo_id)
    sessoes_realizadas_mes = conn.execute(sql_realizadas, params_real).fetchone()["c"]

    # Próximos vencimentos pendentes (Receitas e Despesas)
    pendencias = rows_to_list(
        conn.execute(
            """
            SELECT f.*, p.nome as paciente_nome
            FROM financeiro f
            LEFT JOIN pacientes p ON p.id = f.paciente_id
            WHERE f.status_pagamento = 'Pendente'
            ORDER BY f.data_vencimento ASC LIMIT 8
            """
        ).fetchall()
    )

    # Despesas do Consultório para a Visão Geral
    despesas_consultorio = rows_to_list(
        conn.execute(
            """
            SELECT f.*
            FROM financeiro f
            WHERE f.tipo = 'Despesa'
            ORDER BY f.data_vencimento DESC, f.id DESC LIMIT 8
            """
        ).fetchall()
    )

    conn.close()
    return {
        "hoje": hoje,
        "mes_atual": mes_atual,
        "total_pacientes_ativos": total_pacientes,
        "total_sessoes_hoje": len(sessoes_hoje),
        "sessoes_realizadas_mes": sessoes_realizadas_mes,
        "sessoes_hoje": sessoes_hoje,
        "financeiro_mes": fin_resumo,
        "pendencias_financeiras": pendencias,
        "despesas_consultorio": despesas_consultorio,
    }


def handle_get_usuarios():
    conn = get_connection()
    ensure_admin_exists(conn)
    rows = conn.execute(
        "SELECT id, nome, email, perfil, crp, abordagem, telefone, valor_sessao_padrao, ativo FROM usuarios WHERE ativo = 1 ORDER BY CASE WHEN perfil = 'admin' THEN 0 WHEN perfil = 'psicologo' THEN 1 ELSE 2 END, nome ASC"
    ).fetchall()
    conn.close()
    return rows_to_list(rows)


def handle_save_usuario(body: dict, usuario_id: int = None):
    nome = (body.get("nome") or "").strip()
    email = (body.get("email") or "").strip()
    perfil = body.get("perfil") or "psicologo"
    crp = (body.get("crp") or "").strip()
    abordagem = (body.get("abordagem") or "").strip()
    telefone = (body.get("telefone") or "").strip()
    valor_sessao_padrao = float(body.get("valor_sessao_padrao") or 150.0)
    senha_raw = (body.get("senha") or "").strip()

    if not nome or not email:
        raise APIError("Nome e e-mail são obrigatórios.")

    conn = get_connection()
    try:
        if usuario_id:
            if senha_raw:
                conn.execute(
                    """
                    UPDATE usuarios SET
                        nome = ?, email = ?, senha_hash = ?, perfil = ?, crp = ?,
                        abordagem = ?, telefone = ?, valor_sessao_padrao = ?
                    WHERE id = ?
                    """,
                    (nome, email, hash_password(senha_raw), perfil, crp, abordagem, telefone, valor_sessao_padrao, usuario_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE usuarios SET
                        nome = ?, email = ?, perfil = ?, crp = ?,
                        abordagem = ?, telefone = ?, valor_sessao_padrao = ?
                    WHERE id = ?
                    """,
                    (nome, email, perfil, crp, abordagem, telefone, valor_sessao_padrao, usuario_id),
                )
            conn.commit()
            msg = "Dados do profissional atualizados com sucesso!"
        else:
            senha_final = senha_raw or "123456"
            cur = conn.execute(
                """
                INSERT INTO usuarios (nome, email, senha_hash, perfil, crp, abordagem, telefone, valor_sessao_padrao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (nome, email, hash_password(senha_final), perfil, crp, abordagem, telefone, valor_sessao_padrao),
            )
            conn.commit()
            usuario_id = cur.lastrowid
            msg = "Profissional cadastrado com sucesso!"
    except Exception as e:
        conn.close()
        raise APIError(f"Erro ao salvar profissional: {str(e)}")
    conn.close()
    return {"id": usuario_id, "mensagem": msg}


def handle_delete_usuario(usuario_id: int):
    conn = get_connection()
    total_ativos = conn.execute("SELECT COUNT(*) as c FROM usuarios WHERE ativo = 1").fetchone()["c"]
    if total_ativos <= 1:
        conn.close()
        raise APIError("Não é possível remover o único profissional ativo do sistema.")
    conn.execute("UPDATE usuarios SET ativo = 0 WHERE id = ?", (usuario_id,))
    conn.commit()
    conn.close()
    return {"mensagem": "Profissional removido da equipe ativa."}


def handle_get_pacientes(query: dict):
    busca = (query.get("busca") or "").strip()
    psicologo_id = query.get("psicologo_id")
    status = query.get("status")

    sql = """
        SELECT p.*, u.nome as psicologo_nome, u.crp as psicologo_crp,
               (SELECT COUNT(*) FROM sessoes s WHERE s.paciente_id = p.id AND s.status = 'Realizada') as total_sessoes_realizadas
        FROM pacientes p
        LEFT JOIN usuarios u ON u.id = p.psicologo_id
        WHERE 1=1
    """
    params = []
    if busca:
        sql += " AND (p.nome LIKE ? OR p.cpf LIKE ? OR p.telefone LIKE ?)"
        params.extend([f"%{busca}%", f"%{busca}%", f"%{busca}%"])
    if psicologo_id:
        sql += " AND p.psicologo_id = ?"
        params.append(psicologo_id)
    if status:
        sql += " AND p.status = ?"
        params.append(status)

    sql += " ORDER BY p.nome ASC"
    conn = get_connection()
    rows = rows_to_list(conn.execute(sql, params).fetchall())
    conn.close()
    return rows


def handle_save_paciente(body: dict, paciente_id: int = None):
    nome = (body.get("nome") or "").strip()
    if not nome:
        raise APIError("O nome do paciente é obrigatório.")

    campos = (
        nome,
        (body.get("cpf") or "").strip() or None,
        body.get("data_nascimento") or None,
        (body.get("telefone") or "").strip(),
        (body.get("email") or "").strip(),
        (body.get("endereco") or "").strip(),
        (body.get("contato_emergencia_nome") or "").strip(),
        (body.get("contato_emergencia_telefone") or "").strip(),
        int(body["psicologo_id"]) if body.get("psicologo_id") else None,
        body.get("modalidade_padrao") or "Presencial",
        body.get("tipo_cobranca") or "Por Sessão",
        float(body.get("valor_acordado") or 150.0),
        body.get("status") or "Ativo",
        (body.get("observacoes_administrativas") or "").strip(),
    )

    conn = get_connection()
    try:
        if paciente_id:
            conn.execute(
                """
                UPDATE pacientes SET
                    nome=?, cpf=?, data_nascimento=?, telefone=?, email=?, endereco=?,
                    contato_emergencia_nome=?, contato_emergencia_telefone=?,
                    psicologo_id=?, modalidade_padrao=?, tipo_cobranca=?, valor_acordado=?,
                    status=?, observacoes_administrativas=?
                WHERE id=?
                """,
                (*campos, paciente_id),
            )
            conn.commit()
            msg = "Dados do paciente atualizados com sucesso!"
        else:
            cur = conn.execute(
                """
                INSERT INTO pacientes (
                    nome, cpf, data_nascimento, telefone, email, endereco,
                    contato_emergencia_nome, contato_emergencia_telefone,
                    psicologo_id, modalidade_padrao, tipo_cobranca, valor_acordado,
                    status, observacoes_administrativas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                campos,
            )
            conn.commit()
            paciente_id = cur.lastrowid
            msg = "Paciente cadastrado com sucesso!"
    except Exception as e:
        conn.close()
        raise APIError(f"Erro ao salvar paciente (verifique se o CPF já existe): {str(e)}")

    conn.close()
    return {"id": paciente_id, "mensagem": msg}


def handle_delete_paciente(paciente_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM pacientes WHERE id = ?", (paciente_id,))
    conn.commit()
    conn.close()
    return {"mensagem": "Paciente removido com sucesso."}


def handle_get_sessoes(query: dict):
    data_inicio = query.get("data_inicio")
    data_fim = query.get("data_fim")
    psicologo_id = query.get("psicologo_id")
    paciente_id = query.get("paciente_id")
    status = query.get("status")

    sql = """
        SELECT s.*, p.nome as paciente_nome, p.telefone as paciente_telefone, p.valor_acordado,
               u.nome as psicologo_nome, u.crp as psicologo_crp
        FROM sessoes s
        JOIN pacientes p ON p.id = s.paciente_id
        JOIN usuarios u ON u.id = s.psicologo_id
        WHERE 1=1
    """
    params = []
    if data_inicio:
        sql += " AND s.data_sessao >= ?"
        params.append(data_inicio)
    if data_fim:
        sql += " AND s.data_sessao <= ?"
        params.append(data_fim)
    if psicologo_id:
        sql += " AND s.psicologo_id = ?"
        params.append(psicologo_id)
    if paciente_id:
        sql += " AND s.paciente_id = ?"
        params.append(paciente_id)
    if status:
        sql += " AND s.status = ?"
        params.append(status)

    sql += " ORDER BY s.data_sessao ASC, s.hora_inicio ASC"
    conn = get_connection()
    rows = rows_to_list(conn.execute(sql, params).fetchall())
    conn.close()
    return rows


def handle_save_sessao(body: dict, sessao_id: int = None):
    paciente_id = body.get("paciente_id")
    psicologo_id = body.get("psicologo_id")
    data_sessao = body.get("data_sessao")
    hora_inicio = body.get("hora_inicio")

    if not all([paciente_id, psicologo_id, data_sessao, hora_inicio]):
        raise APIError("Paciente, psicólogo, data e horário são obrigatórios.")

    duracao = int(body.get("duracao_minutos") or 50)
    modalidade = body.get("modalidade") or "Presencial"
    tipo_sessao = body.get("tipo_sessao") or "Individual"
    status = body.get("status") or "Agendada"
    observacoes = (body.get("observacoes_agenda") or "").strip()
    gerar_cobranca = bool(body.get("gerar_cobranca", True))

    conn = get_connection()
    if sessao_id:
        conn.execute(
            """
            UPDATE sessoes SET
                paciente_id=?, psicologo_id=?, data_sessao=?, hora_inicio=?,
                duracao_minutos=?, modalidade=?, tipo_sessao=?, status=?, observacoes_agenda=?
            WHERE id=?
            """,
            (
                paciente_id,
                psicologo_id,
                data_sessao,
                hora_inicio,
                duracao,
                modalidade,
                tipo_sessao,
                status,
                observacoes,
                sessao_id,
            ),
        )
        msg = "Sessão atualizada com sucesso!"
    else:
        cur = conn.execute(
            """
            INSERT INTO sessoes (
                paciente_id, psicologo_id, data_sessao, hora_inicio,
                duracao_minutos, modalidade, tipo_sessao, status, observacoes_agenda
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                paciente_id,
                psicologo_id,
                data_sessao,
                hora_inicio,
                duracao,
                modalidade,
                tipo_sessao,
                status,
                observacoes,
            ),
        )
        sessao_id = cur.lastrowid
        msg = "Sessão agendada com sucesso!"

        # Gera lançamento financeiro se solicitado e cobrança for por sessão
        if gerar_cobranca:
            pac = conn.execute(
                "SELECT nome, valor_acordado, tipo_cobranca FROM pacientes WHERE id = ?",
                (paciente_id,),
            ).fetchone()
            if pac and pac["tipo_cobranca"] == "Por Sessão" and pac["valor_acordado"] > 0:
                conn.execute(
                    """
                    INSERT INTO financeiro (
                        tipo, categoria, descricao, paciente_id, psicologo_id, sessao_id,
                        valor, data_vencimento, status_pagamento, forma_pagamento
                    ) VALUES ('Receita', 'Sessão', ?, ?, ?, ?, ?, ?, 'Pendente', 'PIX')
                    """,
                    (
                        f"Sessão ({tipo_sessao}) - {pac['nome']}",
                        paciente_id,
                        psicologo_id,
                        sessao_id,
                        pac["valor_acordado"],
                        data_sessao,
                    ),
                )

    conn.commit()
    conn.close()
    return {"id": sessao_id, "mensagem": msg}


def handle_status_sessao(sessao_id: int, body: dict):
    novo_status = body.get("status")
    nova_data = body.get("data_sessao")
    nova_hora = body.get("hora_inicio")
    if not novo_status:
        raise APIError("Status não informado.")

    conn = get_connection()
    if nova_data and nova_hora:
        conn.execute(
            "UPDATE sessoes SET status = ?, data_sessao = ?, hora_inicio = ? WHERE id = ?",
            (novo_status, nova_data, nova_hora, sessao_id),
        )
    else:
        conn.execute(
            "UPDATE sessoes SET status = ? WHERE id = ?",
            (novo_status, sessao_id),
        )
    conn.commit()
    conn.close()
    return {"mensagem": f"Status da sessão atualizado para '{novo_status}'."}


def handle_delete_sessao(sessao_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM sessoes WHERE id = ?", (sessao_id,))
    conn.commit()
    conn.close()
    return {"mensagem": "Sessão excluída com sucesso."}


# ==========================================
# PRONTUÁRIO E ANAMNESE (SIGILO PROFISSIONAL)
# ==========================================

def handle_get_prontuario(paciente_id: int, headers: dict):
    user = require_psicologo(headers)
    conn = get_connection()

    paciente = conn.execute(
        """
        SELECT p.*, u.nome as psicologo_nome, u.crp as psicologo_crp
        FROM pacientes p
        LEFT JOIN usuarios u ON u.id = p.psicologo_id
        WHERE p.id = ?
        """,
        (paciente_id,),
    ).fetchone()
    if not paciente:
        conn.close()
        raise APIError("Paciente não encontrado.", 404)

    anamnese = conn.execute(
        "SELECT * FROM anamneses WHERE paciente_id = ?", (paciente_id,)
    ).fetchone()

    evolucoes = rows_to_list(
        conn.execute(
            """
            SELECT e.*, u.nome as psicologo_nome, u.crp as psicologo_crp,
                   s.data_sessao, s.hora_inicio, s.modalidade, s.tipo_sessao
            FROM prontuario_evolucoes e
            JOIN usuarios u ON u.id = e.psicologo_id
            LEFT JOIN sessoes s ON s.id = e.sessao_id
            WHERE e.paciente_id = ?
            ORDER BY e.data_registro DESC, e.id DESC
            """,
            (paciente_id,),
        ).fetchall()
    )

    sessoes_paciente = rows_to_list(
        conn.execute(
            """
            SELECT id, data_sessao, hora_inicio, tipo_sessao, status, modalidade
            FROM sessoes
            WHERE paciente_id = ?
            ORDER BY data_sessao DESC, hora_inicio DESC
            """,
            (paciente_id,),
        ).fetchall()
    )

    conn.close()
    return {
        "usuario_acesso": user["nome"],
        "paciente": row_to_dict(paciente),
        "anamnese": row_to_dict(anamnese),
        "evolucoes": evolucoes,
        "sessoes": sessoes_paciente,
    }


def handle_save_anamnese(paciente_id: int, body: dict, headers: dict):
    user = require_psicologo(headers)
    conn = get_connection()

    existente = conn.execute(
        "SELECT id FROM anamneses WHERE paciente_id = ?", (paciente_id,)
    ).fetchone()

    agora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    valores = (
        body.get("queixa_principal") or "",
        body.get("historico_sintomas") or "",
        body.get("historico_familiar") or "",
        body.get("historico_medico_psiquiatrico") or "",
        body.get("medicamentos_em_uso") or "",
        body.get("rotina_sono_alimentacao") or "",
        body.get("expectativas_tratamento") or "",
        body.get("hipotese_inicial") or "",
        body.get("plano_terapeutico") or "",
        agora,
    )

    if existente:
        conn.execute(
            """
            UPDATE anamneses SET
                queixa_principal=?, historico_sintomas=?, historico_familiar=?,
                historico_medico_psiquiatrico=?, medicamentos_em_uso=?,
                rotina_sono_alimentacao=?, expectativas_tratamento=?,
                hipotese_inicial=?, plano_terapeutico=?, atualizado_em=?
            WHERE paciente_id=?
            """,
            (*valores, paciente_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO anamneses (
                queixa_principal, historico_sintomas, historico_familiar,
                historico_medico_psiquiatrico, medicamentos_em_uso,
                rotina_sono_alimentacao, expectativas_tratamento,
                hipotese_inicial, plano_terapeutico, atualizado_em,
                paciente_id, psicologo_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (*valores, paciente_id, user["id"]),
        )

    conn.commit()
    conn.close()
    return {"mensagem": "Ficha de Anamnese salva com sigilo no prontuário!"}


def handle_create_evolucao(body: dict, headers: dict):
    user = require_psicologo(headers)
    paciente_id = body.get("paciente_id")
    relato = (body.get("relato_evolucao") or "").strip()
    if not paciente_id or not relato:
        raise APIError("Paciente e relato de evolução clínica são obrigatórios.")

    sessao_id = body.get("sessao_id") or None
    data_registro = body.get("data_registro") or datetime.now().strftime("%Y-%m-%d")
    humor_estado = (body.get("humor_estado") or "").strip()
    intervencoes = (body.get("intervencoes_realizadas") or "").strip()
    tarefas = (body.get("tarefas_encaminhamentos") or "").strip()
    obs_sigilosas = (body.get("observacoes_sigilosas") or "").strip()

    conn = get_connection()
    cur = conn.execute(
        """
        INSERT INTO prontuario_evolucoes (
            paciente_id, psicologo_id, sessao_id, data_registro,
            humor_estado, relato_evolucao, intervencoes_realizadas,
            tarefas_encaminhamentos, observacoes_sigilosas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            paciente_id,
            user["id"],
            sessao_id,
            data_registro,
            humor_estado,
            relato,
            intervencoes,
            tarefas,
            obs_sigilosas,
        ),
    )
    if sessao_id:
        conn.execute(
            "UPDATE sessoes SET status = 'Realizada' WHERE id = ?", (sessao_id,)
        )
    conn.commit()
    evo_id = cur.lastrowid
    conn.close()
    return {"id": evo_id, "mensagem": "Evolução de sessão registrada no prontuário!"}


def handle_delete_evolucao(evolucao_id: int, headers: dict):
    require_psicologo(headers)
    conn = get_connection()
    conn.execute("DELETE FROM prontuario_evolucoes WHERE id = ?", (evolucao_id,))
    conn.commit()
    conn.close()
    return {"mensagem": "Registro de evolução removido."}


# ==========================================
# CONTROLE FINANCEIRO E RECIBOS
# ==========================================

def handle_get_financeiro(query: dict):
    mes = query.get("mes")  # YYYY-MM
    tipo = query.get("tipo")
    categoria = query.get("categoria")
    status_pagamento = query.get("status_pagamento")
    paciente_id = query.get("paciente_id")

    conn = get_connection()
    # Garantir que despesas do consultório nunca fiquem vinculadas a pacientes
    conn.execute(
        "UPDATE financeiro SET paciente_id = NULL, psicologo_id = NULL WHERE tipo = 'Despesa' AND (paciente_id IS NOT NULL OR psicologo_id IS NOT NULL)"
    )
    conn.execute("UPDATE financeiro SET categoria = 'Energia' WHERE id = 15 AND categoria = 'Despesas'")
    conn.execute("UPDATE financeiro SET categoria = 'Aluguel da Clínica' WHERE id = 7 AND categoria = 'Despesas'")
    conn.commit()

    sql = """
        SELECT f.*, p.nome as paciente_nome, p.cpf as paciente_cpf,
               u.nome as psicologo_nome, u.crp as psicologo_crp
        FROM financeiro f
        LEFT JOIN pacientes p ON p.id = f.paciente_id
        LEFT JOIN usuarios u ON u.id = f.psicologo_id
        WHERE 1=1
    """
    params = []
    if mes:
        sql += " AND substr(f.data_vencimento, 1, 7) = ?"
        params.append(mes)
    if tipo:
        sql += " AND f.tipo = ?"
        params.append(tipo)
    if categoria:
        sql += " AND f.categoria = ?"
        params.append(categoria)
    if status_pagamento:
        sql += " AND f.status_pagamento = ?"
        params.append(status_pagamento)
    if paciente_id:
        sql += " AND f.paciente_id = ?"
        params.append(paciente_id)

    sql += " ORDER BY f.data_vencimento DESC, f.id DESC"
    lancamentos = rows_to_list(conn.execute(sql, params).fetchall())
    conn.close()

    receitas_pagas = sum(
        x["valor"] for x in lancamentos if x["tipo"] == "Receita" and x["status_pagamento"] == "Pago"
    )
    receitas_a_receber = sum(
        x["valor"] for x in lancamentos if x["tipo"] == "Receita" and x["status_pagamento"] == "Pendente"
    )
    despesas_pendentes = sum(
        x["valor"] for x in lancamentos if x["tipo"] == "Despesa" and x["status_pagamento"] == "Pendente"
    )
    total_pendentes = receitas_a_receber + despesas_pendentes
    despesas_pagas = sum(
        x["valor"] for x in lancamentos if x["tipo"] == "Despesa" and x["status_pagamento"] == "Pago"
    )

    return {
        "resumo": {
            "receitas_pagas": receitas_pagas,
            "receitas_pendentes": total_pendentes,
            "receitas_a_receber": receitas_a_receber,
            "despesas_pendentes": despesas_pendentes,
            "despesas": despesas_pagas,
            "saldo_liquido": receitas_pagas - despesas_pagas,
        },
        "lancamentos": lancamentos,
    }


def handle_save_financeiro(body: dict, fin_id: int = None):
    tipo = body.get("tipo") or "Receita"
    categoria = body.get("categoria") or "Sessão"
    descricao = (body.get("descricao") or "").strip()
    valor = float(body.get("valor") or 0)
    data_vencimento = body.get("data_vencimento") or datetime.now().strftime("%Y-%m-%d")
    status_pagamento = body.get("status_pagamento") or "Pendente"
    forma_pagamento = body.get("forma_pagamento") or "PIX"
    paciente_id = int(body["paciente_id"]) if body.get("paciente_id") else None
    psicologo_id = int(body["psicologo_id"]) if body.get("psicologo_id") else None
    if tipo == "Despesa":
        # Despesas são exclusivas do consultório
        paciente_id = None
        psicologo_id = None
    observacoes = (body.get("observacoes") or "").strip()

    if not descricao or valor <= 0:
        raise APIError("Descrição e valor maior que zero são obrigatórios.")

    data_pagamento = body.get("data_pagamento")
    if status_pagamento == "Pago" and not data_pagamento:
        data_pagamento = datetime.now().strftime("%Y-%m-%d")
    elif status_pagamento != "Pago":
        data_pagamento = None

    conn = get_connection()
    if fin_id:
        conn.execute(
            """
            UPDATE financeiro SET
                tipo=?, categoria=?, descricao=?, paciente_id=?, psicologo_id=?,
                valor=?, data_vencimento=?, data_pagamento=?, status_pagamento=?,
                forma_pagamento=?, observacoes=?
            WHERE id=?
            """,
            (
                tipo,
                categoria,
                descricao,
                paciente_id,
                psicologo_id,
                valor,
                data_vencimento,
                data_pagamento,
                status_pagamento,
                forma_pagamento,
                observacoes,
                fin_id,
            ),
        )
        msg = "Lançamento financeiro atualizado!"
    else:
        cur = conn.execute(
            """
            INSERT INTO financeiro (
                tipo, categoria, descricao, paciente_id, psicologo_id,
                valor, data_vencimento, data_pagamento, status_pagamento,
                forma_pagamento, observacoes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tipo,
                categoria,
                descricao,
                paciente_id,
                psicologo_id,
                valor,
                data_vencimento,
                data_pagamento,
                status_pagamento,
                forma_pagamento,
                observacoes,
            ),
        )
        fin_id = cur.lastrowid
        msg = "Lançamento financeiro registrado!"

    conn.commit()
    conn.close()
    return {"id": fin_id, "mensagem": msg}


def handle_quitar_financeiro(fin_id: int, body: dict):
    forma = body.get("forma_pagamento") or "PIX"
    hoje = datetime.now().strftime("%Y-%m-%d")
    conn = get_connection()
    conn.execute(
        "UPDATE financeiro SET status_pagamento = 'Pago', data_pagamento = ?, forma_pagamento = ? WHERE id = ?",
        (hoje, forma, fin_id),
    )
    conn.commit()
    conn.close()
    return {"mensagem": "Pagamento confirmado com sucesso!"}


def handle_delete_financeiro(fin_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM financeiro WHERE id = ?", (fin_id,))
    conn.commit()
    conn.close()
    return {"mensagem": "Lançamento financeiro excluído."}


# ==========================================
# ROTEADOR WSGI UNIVERSAL (Funciona com ou sem Flask)
# ==========================================

def dispatch_api(method: str, path: str, query: dict, body: dict, headers: dict):
    if path == "/api/login" and method == "POST":
        return handle_login(body)
    if path == "/api/dashboard" and method == "GET":
        require_admin(headers)
        return handle_dashboard(query, headers)
    if path == "/api/usuarios" and method == "GET":
        return handle_get_usuarios()
    if path == "/api/usuarios" and method == "POST":
        require_admin(headers)
        uid_body = int(body["id"]) if body.get("id") else None
        return handle_save_usuario(body, uid_body)
    m_usr = re.match(r"^/api/usuarios/(\d+)$", path)
    if m_usr:
        require_admin(headers)
        uid = int(m_usr.group(1))
        if method in ("PUT", "POST"):
            return handle_save_usuario(body, uid)
        if method == "DELETE":
            return handle_delete_usuario(uid)

    # Pacientes
    if path == "/api/pacientes" and method == "GET":
        return handle_get_pacientes(query)
    if path == "/api/pacientes" and method == "POST":
        require_admin(headers)
        return handle_save_paciente(body)
    m_pac = re.match(r"^/api/pacientes/(\d+)$", path)
    if m_pac:
        require_admin(headers)
        pid = int(m_pac.group(1))
        if method == "PUT":
            return handle_save_paciente(body, pid)
        if method == "DELETE":
            return handle_delete_paciente(pid)

    # Sessões / Agenda (Acessível por Admin e Doutores)
    if path == "/api/sessoes" and method == "GET":
        require_psicologo(headers)
        return handle_get_sessoes(query)
    if path == "/api/sessoes" and method == "POST":
        require_psicologo(headers)
        return handle_save_sessao(body)
    m_ses = re.match(r"^/api/sessoes/(\d+)$", path)
    if m_ses:
        require_psicologo(headers)
        sid = int(m_ses.group(1))
        if method == "PUT":
            return handle_save_sessao(body, sid)
        if method == "DELETE":
            return handle_delete_sessao(sid)
    m_ses_st = re.match(r"^/api/sessoes/(\d+)/status$", path)
    if m_ses_st and method == "PATCH":
        require_psicologo(headers)
        return handle_status_sessao(int(m_ses_st.group(1)), body)

    # Prontuário e Anamnese (Acessível por Admin e Doutores)
    m_pront = re.match(r"^/api/prontuario/(\d+)$", path)
    if m_pront and method == "GET":
        return handle_get_prontuario(int(m_pront.group(1)), headers)
    m_anam = re.match(r"^/api/anamnese/(\d+)$", path)
    if m_anam and method == "POST":
        return handle_save_anamnese(int(m_anam.group(1)), body, headers)
    if path == "/api/evolucoes" and method == "POST":
        return handle_create_evolucao(body, headers)
    m_evo = re.match(r"^/api/evolucoes/(\d+)$", path)
    if m_evo and method == "DELETE":
        return handle_delete_evolucao(int(m_evo.group(1)), headers)

    # Financeiro (Exclusivo Admin)
    if path == "/api/financeiro" and method == "GET":
        require_admin(headers)
        return handle_get_financeiro(query)
    if path == "/api/financeiro" and method == "POST":
        require_admin(headers)
        return handle_save_financeiro(body)
    m_fin = re.match(r"^/api/financeiro/(\d+)$", path)
    if m_fin:
        require_admin(headers)
        fid = int(m_fin.group(1))
        if method == "PUT":
            return handle_save_financeiro(body, fid)
        if method == "DELETE":
            return handle_delete_financeiro(fid)
    m_fin_pay = re.match(r"^/api/financeiro/(\d+)/pagar$", path)
    if m_fin_pay and method == "PATCH":
        require_admin(headers)
        return handle_quitar_financeiro(int(m_fin_pay.group(1)), body)

    raise APIError(f"Rota não encontrada: {method} {path}", 404)


_LAST_MTIME = os.path.getmtime(__file__)


def _check_hot_reload():
    global _LAST_MTIME
    try:
        current_mtime = os.path.getmtime(__file__)
        if current_mtime > _LAST_MTIME:
            _LAST_MTIME = current_mtime
            with open(__file__, "r", encoding="utf-8") as f:
                code = f.read()
            exec(compile(code, __file__, "exec"), globals())
    except Exception as e:
        print(f"[HotReload] Aviso: {e}")


def wsgi_app(environ, start_response):
    _check_hot_reload()
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/")
    query_raw = parse_qs(environ.get("QUERY_STRING", ""))
    query = {k: v[0] for k, v in query_raw.items()}

    headers = {}
    for k, v in environ.items():
        if k.startswith("HTTP_"):
            h_name = k[5:].replace("_", "-").title()
            headers[h_name] = v

    no_cache = [("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")]

    # Servir página principal
    if path == "/" and method == "GET":
        index_path = os.path.join(BASE_DIR, "templates", "index.html")
        with open(index_path, "rb") as f:
            content = f.read()
        start_response("200 OK", [("Content-Type", "text/html; charset=utf-8")] + no_cache)
        return [content]

    # Servir arquivos estáticos
    if path.startswith("/static/") and method == "GET":
        rel_path = path.lstrip("/").replace("/", os.sep)
        abs_path = os.path.abspath(os.path.join(BASE_DIR, rel_path))
        if abs_path.startswith(os.path.join(BASE_DIR, "static")) and os.path.isfile(abs_path):
            mime, _ = mimetypes.guess_type(abs_path)
            with open(abs_path, "rb") as f:
                content = f.read()
            start_response(
                "200 OK",
                [("Content-Type", f"{mime or 'application/octet-stream'}; charset=utf-8")] + no_cache,
            )
            return [content]
        start_response("404 Not Found", [("Content-Type", "text/plain; charset=utf-8")])
        return [b"Arquivo nao encontrado"]

    # Rotas de API
    if path.startswith("/api/"):
        try:
            content_length = int(environ.get("CONTENT_LENGTH") or 0)
            body = {}
            if content_length > 0:
                raw_body = environ["wsgi.input"].read(content_length).decode("utf-8")
                if raw_body.strip():
                    body = json.loads(raw_body)
            result = dispatch_api(method, path, query, body, headers)
            payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
            start_response("200 OK", [("Content-Type", "application/json; charset=utf-8")] + no_cache)
            return [payload]
        except APIError as err:
            status_map = {
                400: "400 Bad Request",
                401: "401 Unauthorized",
                403: "403 Forbidden",
                404: "404 Not Found",
            }
            payload = json.dumps({"erro": err.message}, ensure_ascii=False).encode("utf-8")
            start_response(
                status_map.get(err.status_code, "400 Bad Request"),
                [("Content-Type", "application/json; charset=utf-8")] + no_cache,
            )
            return [payload]
        except Exception as exc:
            payload = json.dumps({"erro": f"Erro interno: {str(exc)}"}, ensure_ascii=False).encode("utf-8")
            start_response("500 Internal Server Error", [("Content-Type", "application/json; charset=utf-8")] + no_cache)
            return [payload]

    start_response("404 Not Found", [("Content-Type", "text/plain; charset=utf-8")])
    return [b"Nao encontrado"]


def _free_port_if_in_use(port: int):
    import subprocess
    import time
    my_pid = os.getpid()
    try:
        out = subprocess.check_output("netstat -ano", shell=True, text=True, errors="ignore")
        pids_to_kill = set()
        for line in out.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                parts = line.split()
                if parts:
                    pid = int(parts[-1])
                    if pid != my_pid and pid > 0:
                        pids_to_kill.add(pid)
        for pid in pids_to_kill:
            subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if pids_to_kill:
            time.sleep(0.5)
    except Exception:
        pass


if __name__ == "__main__" and not globals().get("_SERVER_RUNNING"):
    _SERVER_RUNNING = True
    init_db()
    port = int(os.environ.get("PORT", 8000))
    _free_port_if_in_use(port)
    print("=" * 60)
    print("  ESPAÇO ISA - Sistema para Clínica de Desenvolvimento Infantil")
    print(f"  Banco de dados SQLite inicializado em: {os.path.join(BASE_DIR, 'clinica.db')}")
    print(f"  Acesse no navegador: http://localhost:{port}")
    print("=" * 60)
    with make_server("0.0.0.0", port, wsgi_app) as httpd:
        httpd.serve_forever()
