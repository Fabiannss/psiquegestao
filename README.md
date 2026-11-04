# Psiquê Gestão — Sistema de Gerenciamento para Clínica de Psicologia

Aplicação Web desenvolvida em **Python + SQLite** para gestão integrada de clínicas e consultórios de psicologia, respeitando o sigilo clínico do Código de Ética Profissional do Psicólogo (CFP).

## Funcionalidades Incluídas (MVP Completo)

1. **Painel Geral (Dashboard)**:
   - Indicadores de pacientes ativos, sessões do dia, sessões realizadas no mês, receitas recebidas e valores a receber.
   - Agenda rápida de hoje e lista de pendências financeiras com baixa em 1 clique.
2. **Cadastro de Pacientes e Psicólogos**:
   - **Psicólogos e Equipe**: Registro de CRP, abordagem teórica (TCC, Psicanálise, etc.), contatos, valor padrão da sessão e controle de perfil (`psicologo` vs `recepcao`).
   - **Pacientes**: Dados cadastrais, CPF, contato de emergência, psicólogo responsável, modalidade (`Presencial`, `Online`, `Híbrido`), formato de cobrança (`Por Sessão`, `Pacote Mensal`, `Convênio`, `Social`) e status (`Ativo`, `Pausado`, `Alta`).
3. **Agenda e Controle de Sessões**:
   - Agendamento de consultas com data, horário, duração, modalidade e tipo de sessão (`Primeira Consulta / Anamnese`, `Individual`, `Casal / Família`, `Infantil`, `Devolutiva`).
   - Alteração rápida de status (`Agendada`, `Confirmada`, `Realizada`, `Falta`, `Remarcada`, `Cancelada`).
   - Geração automática opcional de cobrança no módulo financeiro ao agendar sessão.
4. **Prontuário Eletrônico e Anamnese (Sigilo Profissional)**:
   - **Controle de Acesso Restrito**: Perfis de recepção/secretaria são bloqueados no backend (`HTTP 403`) e no frontend de visualizar dados clínicos.
   - **Ficha de Anamnese**: Queixa principal, histórico de sintomas, histórico familiar, histórico médico/psiquiátrico, medicamentos em uso, rotina, hipótese diagnóstica e plano terapêutico.
   - **Evolução de Sessões**: Linha do tempo com relatos técnicos de cada sessão, estado emocional/humor, intervenções realizadas e tarefas terapêuticas.
   - **Declaração de Comparecimento**: Geração de documento pronto para impressão/PDF.
5. **Controle Financeiro e Emissão de Recibos**:
   - Controle de receitas (sessões, pacotes) e despesas da clínica (aluguel, CRP, impostos).
   - Baixa rápida de pagamentos e emissão de **Recibo de Pagamento** formatado para impressão com CPF do paciente e CRP do psicólogo.

## Como Executar

A aplicação utiliza apenas bibliotecas nativas do Python (`sqlite3`, `wsgiref`, `json`), portanto **não requer instalação de pacotes externos** para rodar!

```powershell
cd c:\Projetos\clinica_psicologia
python app.py
```

Depois, abra no navegador:
- **http://localhost:8000**
