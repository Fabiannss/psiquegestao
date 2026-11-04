import sqlite3
import hashlib
import os
import shutil
from datetime import datetime, timedelta

def get_db_path():
    if os.environ.get("VERCEL"):
        tmp_db = "/tmp/clinica.db"
        orig_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "clinica.db")
        if not os.path.exists(tmp_db) and os.path.exists(orig_db):
            shutil.copy2(orig_db, tmp_db)
        return tmp_db
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "clinica.db")

DB_PATH = get_db_path()


def get_connection():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Tabela de Usuários / Psicólogos e Recepção
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        perfil TEXT NOT NULL CHECK(perfil IN ('psicologo', 'admin', 'recepcao')),
        crp TEXT,
        abordagem TEXT,
        telefone TEXT,
        valor_sessao_padrao REAL DEFAULT 150.0,
        ativo INTEGER DEFAULT 1,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 2. Tabela de Pacientes
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pacientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        cpf TEXT UNIQUE,
        data_nascimento TEXT,
        telefone TEXT,
        email TEXT,
        endereco TEXT,
        contato_emergencia_nome TEXT,
        contato_emergencia_telefone TEXT,
        psicologo_id INTEGER,
        modalidade_padrao TEXT DEFAULT 'Presencial' CHECK(modalidade_padrao IN ('Presencial', 'Online', 'Híbrido')),
        tipo_cobranca TEXT DEFAULT 'Por Sessão' CHECK(tipo_cobranca IN ('Por Sessão', 'Pacote Mensal', 'Convênio', 'Social')),
        valor_acordado REAL DEFAULT 150.0,
        status TEXT DEFAULT 'Ativo' CHECK(status IN ('Ativo', 'Pausado', 'Alta', 'Inativo')),
        observacoes_administrativas TEXT,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (psicologo_id) REFERENCES usuarios(id) ON DELETE SET NULL
    )
    """)

    # 3. Tabela de Anamnese (Sigilo Clínico - Restrito ao Psicólogo)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS anamneses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paciente_id INTEGER UNIQUE NOT NULL,
        psicologo_id INTEGER NOT NULL,
        queixa_principal TEXT,
        historico_sintomas TEXT,
        historico_familiar TEXT,
        historico_medico_psiquiatrico TEXT,
        medicamentos_em_uso TEXT,
        rotina_sono_alimentacao TEXT,
        expectativas_tratamento TEXT,
        hipotese_inicial TEXT,
        plano_terapeutico TEXT,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (psicologo_id) REFERENCES usuarios(id)
    )
    """)

    # 4. Tabela de Agenda / Sessões
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paciente_id INTEGER NOT NULL,
        psicologo_id INTEGER NOT NULL,
        data_sessao TEXT NOT NULL,
        hora_inicio TEXT NOT NULL,
        duracao_minutos INTEGER DEFAULT 50,
        modalidade TEXT DEFAULT 'Presencial' CHECK(modalidade IN ('Presencial', 'Online')),
        tipo_sessao TEXT DEFAULT 'Individual' CHECK(tipo_sessao IN ('Primeira Consulta / Anamnese', 'Individual', 'Casal / Família', 'Infantil', 'Devolutiva')),
        status TEXT DEFAULT 'Agendada' CHECK(status IN ('Agendada', 'Confirmada', 'Realizada', 'Falta', 'Cancelada', 'Remarcada')),
        observacoes_agenda TEXT,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (psicologo_id) REFERENCES usuarios(id)
    )
    """)

    # 5. Tabela de Prontuário / Evolução de Sessões (Sigilo Clínico - Restrito ao Psicólogo)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS prontuario_evolucoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paciente_id INTEGER NOT NULL,
        psicologo_id INTEGER NOT NULL,
        sessao_id INTEGER,
        data_registro TEXT NOT NULL,
        humor_estado TEXT,
        relato_evolucao TEXT NOT NULL,
        intervencoes_realizadas TEXT,
        tarefas_encaminhamentos TEXT,
        observacoes_sigilosas TEXT,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (psicologo_id) REFERENCES usuarios(id),
        FOREIGN KEY (sessao_id) REFERENCES sessoes(id) ON DELETE SET NULL
    )
    """)

    # 6. Tabela Financeira (Receitas de Sessões/Pacotes e Despesas da Clínica)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS financeiro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL DEFAULT 'Receita' CHECK(tipo IN ('Receita', 'Despesa')),
        categoria TEXT NOT NULL DEFAULT 'Sessão',
        descricao TEXT NOT NULL,
        paciente_id INTEGER,
        psicologo_id INTEGER,
        sessao_id INTEGER,
        valor REAL NOT NULL,
        data_vencimento TEXT NOT NULL,
        data_pagamento TEXT,
        status_pagamento TEXT DEFAULT 'Pendente' CHECK(status_pagamento IN ('Pendente', 'Pago', 'Cancelado')),
        forma_pagamento TEXT DEFAULT 'PIX' CHECK(forma_pagamento IN ('PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro', 'Transferência', 'Convênio')),
        observacoes TEXT,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE SET NULL,
        FOREIGN KEY (psicologo_id) REFERENCES usuarios(id) ON DELETE SET NULL,
        FOREIGN KEY (sessao_id) REFERENCES sessoes(id) ON DELETE SET NULL
    )
    """)

    conn.commit()
    seed_initial_data(conn)
    ensure_admin_user(conn)
    conn.close()


def ensure_admin_user(conn: sqlite3.Connection):
    cursor = conn.cursor()
    adm = cursor.execute("SELECT id FROM usuarios WHERE perfil = 'admin' AND ativo = 1").fetchone()
    if not adm:
        cursor.execute(
            """
            INSERT OR IGNORE INTO usuarios (nome, email, senha_hash, perfil, crp, abordagem, telefone, valor_sessao_padrao, ativo)
            VALUES (?, ?, ?, 'admin', NULL, 'Administração Geral', '(11) 99999-0000', 0.0, 1)
            """,
            ("Administrador da Clínica", "admin@clinica.psi.br", hash_password("123456")),
        )
        conn.commit()


def seed_initial_data(conn: sqlite3.Connection):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total FROM usuarios")
    if cursor.fetchone()["total"] > 0:
        return

    hoje = datetime.now().strftime("%Y-%m-%d")
    ontem = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    amanha = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    semana_passada = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    # Usuários iniciais
    usuarios = [
        (
            "Dra. Helena Martins",
            "helena@clinica.psi.br",
            hash_password("123456"),
            "psicologo",
            "CRP 06/145892",
            "Terapia Cognitivo-Comportamental (TCC)",
            "(11) 99812-3456",
            180.0,
        ),
        (
            "Dr. Rafael Mendes",
            "rafael@clinica.psi.br",
            hash_password("123456"),
            "psicologo",
            "CRP 06/162310",
            "Psicanálise",
            "(11) 99741-8520",
            200.0,
        ),
        (
            "Carla Souza (Recepção)",
            "recepcao@clinica.psi.br",
            hash_password("123456"),
            "recepcao",
            None,
            "Atendimento e Recepção",
            "(11) 99111-2233",
            0.0,
        ),
    ]
    cursor.executemany(
        """
        INSERT INTO usuarios (nome, email, senha_hash, perfil, crp, abordagem, telefone, valor_sessao_padrao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        usuarios,
    )

    # Pacientes iniciais
    pacientes = [
        (
            "Mariana Costa Silva",
            "345.678.901-12",
            "1994-05-14",
            "(11) 98765-4321",
            "mariana.costa@email.com",
            "Rua das Palmeiras, 240 - Apto 42, São Paulo/SP",
            "Roberto Silva (Esposo)",
            "(11) 98765-1111",
            1,
            "Presencial",
            "Por Sessão",
            180.0,
            "Ativo",
            "Prefere horários no período da manhã.",
        ),
        (
            "Lucas Oliveira Santos",
            "412.890.123-45",
            "1988-11-22",
            "(11) 97654-3210",
            "lucas.santos@email.com",
            "Av. Paulista, 1500 - Bela Vista, São Paulo/SP",
            "Ana Santos (Mãe)",
            "(11) 97654-0000",
            1,
            "Online",
            "Pacote Mensal",
            680.0,
            "Ativo",
            "Fechou pacote mensal de 4 sessões.",
        ),
        (
            "Beatriz Ferreira Lima",
            "289.456.123-88",
            "2001-03-08",
            "(11) 96543-2109",
            "bia.lima@email.com",
            "Rua Augusta, 890 - Consolação, São Paulo/SP",
            "Marcos Lima (Pai)",
            "(11) 96543-9999",
            2,
            "Presencial",
            "Por Sessão",
            200.0,
            "Ativo",
            "Encaminhada por psiquiatra parceiro.",
        ),
    ]
    cursor.executemany(
        """
        INSERT INTO pacientes (
            nome, cpf, data_nascimento, telefone, email, endereco,
            contato_emergencia_nome, contato_emergencia_telefone,
            psicologo_id, modalidade_padrao, tipo_cobranca, valor_acordado,
            status, observacoes_administrativas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        pacientes,
    )

    # Anamnese inicial (Mariana - Dra. Helena)
    cursor.execute(
        """
        INSERT INTO anamneses (
            paciente_id, psicologo_id, queixa_principal, historico_sintomas,
            historico_familiar, historico_medico_psiquiatrico, medicamentos_em_uso,
            rotina_sono_alimentacao, expectativas_tratamento, hipotese_inicial, plano_terapeutico
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            1,
            1,
            "Ansiedade intensa relacionada ao ambiente de trabalho, insônia inicial e dificuldade em estabelecer limites profissionais.",
            "Sintomas iniciaram há cerca de 8 meses após promoção para cargo de gestão. Relata taquicardia aos domingos à noite e preocupação constante.",
            "Mãe com histórico de transtorno de ansiedade generalizada. Bom suporte conjugal.",
            "Check-up clínico recente sem alterações tireoidianas ou vitamínicas.",
            "Não faz uso de psicofármacos no momento.",
            "Sono fragmentado (média de 5h30 por noite). Alimentação irregular durante a semana.",
            "Aprender a manejar crises de ansiedade, melhorar qualidade do sono e desenvolver assertividade.",
            "Quadro compatível com Transtorno de Ansiedade Generalizada (TAG) / Estresse Ocupacional.",
            "Psicoeducação sobre o modelo cognitivo da ansiedade, higiene do sono, registro de pensamentos disfuncionais (RPD) e treino de assertividade.",
        ),
    )

    # Sessões iniciais
    sessoes = [
        (1, 1, semana_passada, "09:00", 50, "Presencial", "Primeira Consulta / Anamnese", "Realizada", "Primeira sessão concluída."),
        (1, 1, hoje, "09:00", 50, "Presencial", "Individual", "Confirmada", "Sessão semanal de acompanhamento."),
        (2, 1, hoje, "10:30", 50, "Online", "Individual", "Agendada", "Enviar link da videochamada 10 min antes."),
        (3, 2, hoje, "14:00", 50, "Presencial", "Individual", "Confirmada", "Atendimento consultório 2."),
        (1, 1, amanha, "09:00", 50, "Presencial", "Individual", "Agendada", "Sessão extra solicitada."),
    ]
    cursor.executemany(
        """
        INSERT INTO sessoes (
            paciente_id, psicologo_id, data_sessao, hora_inicio, duracao_minutos,
            modalidade, tipo_sessao, status, observacoes_agenda
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        sessoes,
    )

    # Evolução clínica inicial
    cursor.execute(
        """
        INSERT INTO prontuario_evolucoes (
            paciente_id, psicologo_id, sessao_id, data_registro, humor_estado,
            relato_evolucao, intervencoes_realizadas, tarefas_encaminhamentos, observacoes_sigilosas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            1,
            1,
            1,
            semana_passada,
            "Ansiosa, porém colaborativa e orientada",
            "Paciente compareceu pontualmente. Relatou sobrecarga intensa na última semana após assumir demandas de dois colegas. Foi acolhida e realizada coleta completa de anamnese. Identificados pensamentos automáticos de catastrofização ('se eu disser não, serei demitida').",
            "Acolhimento empático, psicoeducação sobre o ciclo da ansiedade e apresentação do Registro de Pensamentos Disfuncionais (RPD).",
            "Observar e anotar situações gatilho de ansiedade ao longo da semana; iniciar ritual de desaceleração 1h antes de dormir.",
            "Bom vínculo terapêutico inicial estabelecido.",
        ),
    )

    # Lançamentos financeiros iniciais
    lancamentos = [
        ("Receita", "Sessão", "Sessão Individual - Mariana Costa Silva", 1, 1, 1, 180.0, semana_passada, semana_passada, "Pago", "PIX", "Comprovante enviado via WhatsApp"),
        ("Receita", "Sessão", "Sessão Individual - Mariana Costa Silva", 1, 1, 2, 180.0, hoje, None, "Pendente", "PIX", "Cobrança referente à sessão de hoje"),
        ("Receita", "Pacote Mensal", "Pacote Mensal (4 sessões) - Lucas Oliveira Santos", 2, 1, 3, 680.0, ontem, ontem, "Pago", "Transferência", "Pacote mensal quitado"),
        ("Receita", "Sessão", "Sessão Individual - Beatriz Ferreira Lima", 3, 2, 4, 200.0, hoje, None, "Pendente", "Cartão de Crédito", ""),
        ("Despesa", "Aluguel / Condomínio", "Locação das Salas e Condomínio Comercial", None, None, None, 1450.0, ontem, ontem, "Pago", "Transferência", "Despesa fixa mensal"),
    ]
    cursor.executemany(
        """
        INSERT INTO financeiro (
            tipo, categoria, descricao, paciente_id, psicologo_id, sessao_id,
            valor, data_vencimento, data_pagamento, status_pagamento, forma_pagamento, observacoes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        lancamentos,
    )

    conn.commit()
